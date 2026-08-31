import { sql } from '@/lib/db';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post, type Posting } from '@/lib/ledger/post';
import { floorDiv, rateOf, type Minor } from '@/lib/money';
import { earnedAsOf, writtenTotal, type IsoDate, type Layer } from '@/lib/premium';
import { stripe } from '@/lib/stripe';
import { assertStripeUp } from '@/lib/ops';
import { loadHeader } from './view';

export type CancelMethod = 'pro_rata' | 'short_rate';

export const SHORT_RATE_PENALTY_BPS = 1000;

export type CancelInput = {
  policyId: string;
  effectiveDate: IsoDate;
  method: CancelMethod;
  reason: string;
  actor: string;
};

export type CancelQuote = {
  policyNumber: string;
  writtenMinor: Minor;
  earnedMinor: Minor;
  unearnedMinor: Minor;
  penaltyMinor: Minor;
  returnedPremiumMinor: Minor;
  returnedTaxMinor: Minor;
  retainedFeeMinor: Minor;
  refundTotalMinor: Minor;
  commissionClawbackMinor: Minor;
  collectedMinor: Minor;
  method: CancelMethod;
};

async function layersFor(policyId: string): Promise<Layer[]> {
  const rows = await sql<{ starts_on: string; ends_on: string; amount_minor: bigint }[]>`
    select starts_on::text, ends_on::text, amount_minor
      from premium_layers where policy_id = ${policyId}::uuid order by starts_on, booked_at
  `;
  return rows.map((r) => ({
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    amountMinor: BigInt(r.amount_minor),
  }));
}

export async function quoteCancellation(input: CancelInput): Promise<CancelQuote> {
  const header = await loadHeader(input.policyId);
  if (!header) throw new Error('policy not found');
  if (header.status !== 'bound') throw new Error(`this policy is already ${header.status}`);
  if (input.effectiveDate < header.termStart || input.effectiveDate > header.termEnd) {
    throw new Error(`cancellation must fall inside ${header.termStart} to ${header.termEnd}`);
  }

  const layers = await layersFor(input.policyId);
  const written = writtenTotal(layers);
  const earned = earnedAsOf(layers, input.effectiveDate);
  const unearned = written - earned;

  const penalty =
    input.method === 'short_rate' ? rateOf(unearned, SHORT_RATE_PENALTY_BPS) : 0n;
  const returnedPremium = unearned - penalty;

  const [taxRow] = await sql<{ tax: bigint; fee: bigint }[]>`
    select
      coalesce(sum(case when l.account_code in ('2100','2110')
                        then (case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
                        else 0 end), 0) as tax,
      coalesce(sum(case when l.account_code = '4100'
                        then (case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
                        else 0 end), 0) as fee
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where e.policy_id = ${input.policyId}::uuid
  `;

  const taxCollected = BigInt(taxRow.tax);
  const returnedTax = written === 0n ? 0n : floorDiv(taxCollected * returnedPremium, written);

  const [paidRow] = await sql<{ paid: bigint }[]>`
    select coalesce(sum(ce.amount_minor), 0) as paid
      from charge_events ce
      join premium_charges pc on pc.id = ce.charge_id
     where pc.policy_id = ${input.policyId}::uuid and ce.kind = 'paid'
  `;
  const collected = BigInt(paidRow.paid);

  const clawback = rateOf(returnedPremium, header.commissionRateBps);

  return {
    policyNumber: header.policyNumber,
    writtenMinor: written,
    earnedMinor: earned,
    unearnedMinor: unearned,
    penaltyMinor: penalty,
    returnedPremiumMinor: returnedPremium,
    returnedTaxMinor: returnedTax,
    retainedFeeMinor: BigInt(taxRow.fee),
    refundTotalMinor: returnedPremium + returnedTax,
    commissionClawbackMinor: clawback,
    collectedMinor: collected,
    method: input.method,
  };
}

export type CancelResult = {
  quote: CancelQuote;
  entryId: string;
  clawbackEntryId: string | null;
  refundId: string | null;
  providerRefundRef: string | null;
  providerNote: string;
};

export async function cancelPolicy(input: CancelInput): Promise<CancelResult> {
  const header = await loadHeader(input.policyId);
  if (!header) throw new Error('policy not found');

  const quote = await quoteCancellation(input);
  if (quote.refundTotalMinor < 0n) throw new Error('cancellation produced a negative refund');

  const [intentRow] = await sql<{ provider_ref: string }[]>`
    select ce.provider_ref
      from charge_events ce
      join premium_charges pc on pc.id = ce.charge_id
     where pc.policy_id = ${input.policyId}::uuid and ce.kind = 'paid'
       and ce.provider_ref is not null
     order by ce.occurred_at desc
     limit 1
  `;

  let entryId!: string;
  let clawbackEntryId: string | null = null;
  let refundId: string | null = null;

  await sql.begin(async (tx) => {
    const [{ next_no }] = await tx<{ next_no: number }[]>`
      select coalesce(max(version_no), 0) + 1 as next_no
        from policy_versions where policy_id = ${input.policyId}::uuid
    `;

    const [standing] = await tx<
      { limit_minor: bigint; deductible_minor: bigint; annual_premium_minor: bigint; exposures: unknown }[]
    >`
      select limit_minor, deductible_minor, annual_premium_minor, exposures
        from policy_versions where policy_id = ${input.policyId}::uuid
       order by effective_date desc, booked_at desc limit 1
    `;

    const [version] = await tx<{ id: string }[]>`
      insert into policy_versions (policy_id, version_no, kind, effective_date, limit_minor,
                                   deductible_minor, annual_premium_minor, exposures, description, actor)
      values (${input.policyId}::uuid, ${next_no}, 'cancellation', ${input.effectiveDate}::date,
              ${standing.limit_minor.toString()}::bigint, ${standing.deductible_minor.toString()}::bigint,
              ${standing.annual_premium_minor.toString()}::bigint,
              ${sql.json(standing.exposures as never)}::jsonb,
              ${`Cancelled ${input.method === 'short_rate' ? 'short rate' : 'pro rata'} effective ${input.effectiveDate}: ${input.reason}`},
              ${input.actor})
      returning id
    `;

    if (quote.unearnedMinor > 0n) {
      await tx`
        insert into premium_layers (policy_id, version_id, starts_on, ends_on, amount_minor)
        values (${input.policyId}::uuid, ${version.id}::uuid, ${input.effectiveDate}::date,
                ${header.termEnd}::date, ${(-quote.unearnedMinor).toString()}::bigint)
      `;
    }

    const lines: Posting[] = [debit(ACCOUNT.unearnedPremium, quote.unearnedMinor)];

    if (quote.returnedTaxMinor > 0n) {
      lines.push(debit(ACCOUNT.surplusLinesTax, quote.returnedTaxMinor));
    }
    if (quote.penaltyMinor > 0n) {
      lines.push(credit(ACCOUNT.earnedPremium, quote.penaltyMinor));
    }
    lines.push(credit(ACCOUNT.refundPayable, quote.refundTotalMinor));

    entryId = await post(
      {
        effectiveDate: input.effectiveDate,
        eventType: 'policy.cancelled',
        memo: `${header.policyNumber} cancelled ${input.method === 'short_rate' ? 'short rate' : 'pro rata'}, unearned premium returned`,
        source: 'staff',
        postingKey: `policy.cancelled:${input.policyId}`,
        policyId: input.policyId,
        brokerId: header.brokerId,
        actor: input.actor,
        lines,
      },
      tx,
    );

    if (quote.commissionClawbackMinor > 0n) {
      clawbackEntryId = await post(
        {
          effectiveDate: input.effectiveDate,
          eventType: 'commission.clawed_back',
          memo: `${header.policyNumber} commission clawed back on returned premium`,
          source: 'staff',
          postingKey: `commission.clawed_back:${input.policyId}`,
          policyId: input.policyId,
          brokerId: header.brokerId,
          actor: input.actor,
          lines: [
            debit(ACCOUNT.commissionPayable, quote.commissionClawbackMinor),
            credit(ACCOUNT.commissionExpense, quote.commissionClawbackMinor),
          ],
        },
        tx,
      );
    }

    await tx`
      update policies set status = 'cancelled' where id = ${input.policyId}::uuid
    `;

    await tx`
      insert into decision_events (actor, action, subject, detail)
      values (${input.actor}, 'policy.cancelled', ${header.policyNumber},
              ${sql.json({
                method: input.method,
                effectiveDate: input.effectiveDate,
                unearned: quote.unearnedMinor.toString(),
                penalty: quote.penaltyMinor.toString(),
                returnedTax: quote.returnedTaxMinor.toString(),
                refund: quote.refundTotalMinor.toString(),
                clawback: quote.commissionClawbackMinor.toString(),
                reason: input.reason,
              })}::jsonb)
    `;
  });

  if (quote.refundTotalMinor === 0n) {
    return {
      quote,
      entryId,
      clawbackEntryId,
      refundId: null,
      providerRefundRef: null,
      providerNote: 'Nothing unearned remained, so no refund was raised.',
    };
  }

  if (!intentRow) {
    const [row] = await sql<{ id: string }[]>`
      insert into refunds (policy_id, reason, premium_minor, surcharge_minor, total_minor,
                           provider, effective_date, created_by)
      values (${input.policyId}::uuid, ${input.reason},
              ${quote.returnedPremiumMinor.toString()}::bigint,
              ${quote.returnedTaxMinor.toString()}::bigint,
              ${quote.refundTotalMinor.toString()}::bigint,
              'unfunded', ${input.effectiveDate}::date, ${input.actor})
      returning id
    `;
    return {
      quote,
      entryId,
      clawbackEntryId,
      refundId: row.id,
      providerRefundRef: null,
      providerNote:
        'Premium was never collected, so there is nothing at the processor to refund. The refund sits as a payable.',
    };
  }

  await assertStripeUp();

  const refundable = quote.refundTotalMinor > quote.collectedMinor ? quote.collectedMinor : quote.refundTotalMinor;

  const providerRefund = await stripe.refunds.create(
    {
      payment_intent: intentRow.provider_ref,
      amount: Number(refundable),
      metadata: { policy_id: input.policyId, policy_number: header.policyNumber },
    },
    { idempotencyKey: `refund:${input.policyId}` },
  );

  const [row] = await sql<{ id: string }[]>`
    insert into refunds (policy_id, reason, premium_minor, surcharge_minor, total_minor,
                         provider, provider_ref, effective_date, created_by)
    values (${input.policyId}::uuid, ${input.reason},
            ${quote.returnedPremiumMinor.toString()}::bigint,
            ${quote.returnedTaxMinor.toString()}::bigint,
            ${quote.refundTotalMinor.toString()}::bigint,
            'stripe', ${providerRefund.id}, ${input.effectiveDate}::date, ${input.actor})
    returning id
  `;

  return {
    quote,
    entryId,
    clawbackEntryId,
    refundId: row.id,
    providerRefundRef: providerRefund.id,
    providerNote: `Stripe refund ${providerRefund.id} raised for ${refundable} minor units, status ${providerRefund.status}.`,
  };
}
