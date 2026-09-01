import { sql } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { assertStripeUp } from '@/lib/ops';
import { abs, format, type Minor } from '@/lib/money';
import type { IsoDate } from '@/lib/premium';
import type { EndorsePricing } from '@/lib/policy/endorse';
import { createPremiumCheckout } from './collect';

export type EndorsementSettlement =
  | { kind: 'charge'; checkoutUrl: string; totalMinor: Minor; note: string }
  | { kind: 'refund'; refundId: string; providerRef: string | null; totalMinor: Minor; note: string }
  | { kind: 'none'; note: string }
  | { kind: 'failed'; note: string };

export type SettleInput = {
  policyId: string;
  versionId: string;
  pricing: EndorsePricing;
  effectiveDate: IsoDate;
  actor: string;
};

export async function settleEndorsement(input: SettleInput): Promise<EndorsementSettlement> {
  const total = input.pricing.totalMinor;

  if (total === 0n) {
    return { kind: 'none', note: 'This endorsement moved no money, so there is nothing to settle.' };
  }

  try {
    return total > 0n ? await raiseCharge(input) : await raiseRefund(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'the provider refused';
    return {
      kind: 'failed',
      note: `The endorsement is booked and the ledger is correct, but the money could not be moved: ${reason}. Nothing was half-written — settle it again once the provider is back.`,
    };
  }
}

async function raiseCharge(input: SettleInput): Promise<EndorsementSettlement> {
  const [existing] = await sql<{ checkout_ref: string; total_minor: bigint }[]>`
    select checkout_ref, total_minor from premium_charges
     where version_id = ${input.versionId}::uuid and reason = 'endorsement'
       and charge_status(id) <> 'voided'
     limit 1
  `;

  if (existing) {
    const session = await stripe.checkout.sessions.retrieve(existing.checkout_ref);
    if (!session.url) throw new Error('the earlier checkout session has expired');
    return {
      kind: 'charge',
      checkoutUrl: session.url,
      totalMinor: BigInt(existing.total_minor),
      note: `A checkout for ${format(BigInt(existing.total_minor))} was already raised on this endorsement. Same link, no second charge.`,
    };
  }

  const checkout = await createPremiumCheckout({
    policyId: input.policyId,
    versionId: input.versionId,
    reason: 'endorsement',
    premiumMinor: input.pricing.proRataPremiumMinor,
    surcharges: input.pricing.surcharges,
    effectiveDate: input.effectiveDate,
    actor: input.actor,
  });

  return {
    kind: 'charge',
    checkoutUrl: checkout.checkoutUrl,
    totalMinor: checkout.totalMinor,
    note: `${format(checkout.totalMinor)} is due from the insured. Send them the payment link — commission books when it settles, not now.`,
  };
}

async function raiseRefund(input: SettleInput): Promise<EndorsementSettlement> {
  const reason = `Endorsement ${input.versionId}`;
  const owed = abs(input.pricing.totalMinor);

  const [already] = await sql<{ id: string; provider_ref: string | null; total_minor: bigint }[]>`
    select id, provider_ref, total_minor from refunds
     where policy_id = ${input.policyId}::uuid and reason = ${reason}
     limit 1
  `;

  if (already) {
    return {
      kind: 'refund',
      refundId: already.id,
      providerRef: already.provider_ref,
      totalMinor: BigInt(already.total_minor),
      note: `This endorsement was already refunded for ${format(BigInt(already.total_minor))}. Nothing sent twice.`,
    };
  }

  const [intentRow] = await sql<{ provider_ref: string }[]>`
    select ce.provider_ref
      from charge_events ce
      join premium_charges pc on pc.id = ce.charge_id
     where pc.policy_id = ${input.policyId}::uuid and ce.kind = 'paid'
       and ce.provider_ref is not null
     order by ce.occurred_at desc
     limit 1
  `;

  const [funds] = await sql<{ collected: bigint; refunded: bigint }[]>`
    select
      coalesce((
        select sum(ce.amount_minor) from charge_events ce
          join premium_charges pc on pc.id = ce.charge_id
         where pc.policy_id = ${input.policyId}::uuid and ce.kind = 'paid'
      ), 0) as collected,
      coalesce((
        select sum(total_minor) from refunds where policy_id = ${input.policyId}::uuid
      ), 0) as refunded
  `;

  const headroom = BigInt(funds.collected) - BigInt(funds.refunded);
  const refundable = owed > headroom ? headroom : owed;

  if (!intentRow || refundable <= 0n) {
    const [row] = await sql<{ id: string }[]>`
      insert into refunds (policy_id, reason, premium_minor, surcharge_minor, total_minor,
                           provider, effective_date, created_by)
      values (${input.policyId}::uuid, ${reason},
              ${abs(input.pricing.proRataPremiumMinor).toString()}::bigint,
              ${abs(input.pricing.surchargeTotalMinor).toString()}::bigint,
              ${owed.toString()}::bigint, 'unfunded', ${input.effectiveDate}::date, ${input.actor})
      returning id
    `;
    return {
      kind: 'refund',
      refundId: row.id,
      providerRef: null,
      totalMinor: owed,
      note: `${format(owed)} is owed back, but no collected premium remains to refund against. It stands as a payable until the insured pays.`,
    };
  }

  await assertStripeUp();

  const providerRefund = await stripe.refunds.create(
    {
      payment_intent: intentRow.provider_ref,
      amount: Number(refundable),
      metadata: { policy_id: input.policyId, endorsement_version: input.versionId },
    },
    { idempotencyKey: `refund:endorsement:${input.versionId}` },
  );

  const [row] = await sql<{ id: string }[]>`
    insert into refunds (policy_id, reason, premium_minor, surcharge_minor, total_minor,
                         provider, provider_ref, effective_date, created_by)
    values (${input.policyId}::uuid, ${reason},
            ${abs(input.pricing.proRataPremiumMinor).toString()}::bigint,
            ${abs(input.pricing.surchargeTotalMinor).toString()}::bigint,
            ${refundable.toString()}::bigint, 'stripe', ${providerRefund.id},
            ${input.effectiveDate}::date, ${input.actor})
    returning id
  `;

  const short = refundable < owed ? ` ${format(owed - refundable)} of it had never been collected, so it stays a payable.` : '';

  return {
    kind: 'refund',
    refundId: row.id,
    providerRef: providerRefund.id,
    totalMinor: refundable,
    note: `Stripe refund ${providerRefund.id} raised for ${format(refundable)}, status ${providerRefund.status}. Cash moves when the webhook settles it.${short}`,
  };
}

export type VoidResult = { voided: boolean; note: string };

export async function voidEndorsementCharge(versionId: string): Promise<VoidResult> {
  const [charge] = await sql<{ id: string; checkout_ref: string; total_minor: bigint; status: string }[]>`
    select id, checkout_ref, total_minor, charge_status(id) as status
      from premium_charges
     where version_id = ${versionId}::uuid and reason = 'endorsement'
     limit 1
  `;

  if (!charge) return { voided: false, note: '' };

  if (charge.status !== 'pending') {
    return {
      voided: false,
      note: `The ${format(BigInt(charge.total_minor))} charge on the reversed version is already ${charge.status}, so it stays and the correction settles against it.`,
    };
  }

  try {
    await stripe.checkout.sessions.expire(charge.checkout_ref);
  } catch {
    void 0;
  }

  await sql`
    insert into charge_events (charge_id, kind, amount_minor, provider_ref, detail)
    values (${charge.id}::uuid, 'voided', ${charge.total_minor.toString()}::bigint,
            ${charge.checkout_ref},
            ${sql.json({ reason: 'the endorsement it was raised for was reversed' })}::jsonb)
  `;

  return {
    voided: true,
    note: `The unpaid ${format(BigInt(charge.total_minor))} checkout raised at the wrong date was expired at Stripe and voided here.`,
  };
}
