import { sql } from '@/lib/db';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post, type Posting } from '@/lib/ledger/post';
import { rateOf } from '@/lib/money';
import { toDate } from '@/lib/premium';

type Outcome = { status: 'processed' | 'parked' | 'ignored'; note?: string; entryId?: string };

type ChargeRow = {
  id: string;
  policy_id: string;
  broker_id: string;
  policy_number: string;
  premium_minor: bigint;
  surcharge_minor: bigint;
  total_minor: bigint;
  commission_rate_bps: number;
  effective_date: string;
};

async function findCharge(chargeId: string): Promise<ChargeRow | null> {
  const [row] = await sql<ChargeRow[]>`
    select c.id, c.policy_id, p.broker_id, p.policy_number,
           c.premium_minor, c.surcharge_minor, c.total_minor,
           b.commission_rate_bps, c.effective_date::text as effective_date
      from premium_charges c
      join policies p on p.id = c.policy_id
      join brokers b on b.id = p.broker_id
     where c.id = ${chargeId}::uuid
  `;
  return row ?? null;
}

export async function applyPaymentSucceeded(input: {
  chargeId: string | null;
  intentId: string;
  amountMinor: bigint;
  occurredAt: Date;
  eventId: string;
}): Promise<Outcome> {
  if (!input.chargeId) {
    return { status: 'parked', note: 'intent carried no charge_id, nothing to match against' };
  }

  const charge = await findCharge(input.chargeId);
  if (!charge) {
    return {
      status: 'parked',
      note: `charge ${input.chargeId} is not in the ledger yet, event held for replay`,
    };
  }

  const total = BigInt(charge.total_minor);
  const premium = BigInt(charge.premium_minor);

  if (input.amountMinor !== total) {
    return {
      status: 'parked',
      note: `provider settled ${input.amountMinor} against an expected ${total}, held for review`,
    };
  }

  const commission = rateOf(premium, charge.commission_rate_bps);
  const settledOn = toDate(input.occurredAt.getTime());

  const lines: Posting[] = [
    debit(ACCOUNT.cash, total),
    credit(ACCOUNT.premiumReceivable, total),
  ];

  if (commission > 0n) {
    lines.push(debit(ACCOUNT.commissionExpense, commission));
    lines.push(credit(ACCOUNT.commissionPayable, commission));
  }

  let entryId!: string;

  await sql.begin(async (tx) => {
    entryId = await post(
      {
        effectiveDate: settledOn,
        eventType: 'premium.collected',
        memo: `${charge.policy_number} premium received, commission earned on collection`,
        source: 'stripe',
        sourceRef: input.intentId,
        postingKey: `premium.collected:${charge.id}`,
        policyId: charge.policy_id,
        brokerId: charge.broker_id,
        bookedAt: input.occurredAt,
        lines,
      },
      tx,
    );

    await tx`
      insert into charge_events (charge_id, kind, amount_minor, provider_ref, entry_id, occurred_at, detail)
      values (${charge.id}::uuid, 'paid', ${total.toString()}::bigint, ${input.intentId},
              ${entryId}::uuid, ${input.occurredAt}, ${sql.json({ event: input.eventId })}::jsonb)
    `;
  });

  return { status: 'processed', entryId, note: `premium.collected posted for ${charge.policy_number}` };
}

export async function applyPaymentFailed(input: {
  chargeId: string | null;
  intentId: string;
  reason: string;
  eventId: string;
}): Promise<Outcome> {
  if (!input.chargeId) return { status: 'parked', note: 'intent carried no charge_id' };

  const charge = await findCharge(input.chargeId);
  if (!charge) return { status: 'parked', note: `charge ${input.chargeId} not found` };

  await sql`
    insert into charge_events (charge_id, kind, provider_ref, detail)
    values (${charge.id}::uuid, 'failed', ${input.intentId},
            ${sql.json({ reason: input.reason, event: input.eventId })}::jsonb)
  `;

  return {
    status: 'processed',
    note: 'payment failed, receivable stays open and nothing moved on the ledger',
  };
}

export async function applyRefundSettled(input: {
  intentId: string | null;
  refundedMinor: bigint;
  eventId: string;
  occurredAt: Date;
}): Promise<Outcome> {
  if (!input.intentId) return { status: 'parked', note: 'refund carried no payment intent' };

  const [link] = await sql<{ charge_id: string; policy_id: string; policy_number: string }[]>`
    select ce.charge_id, c.policy_id, p.policy_number
      from charge_events ce
      join premium_charges c on c.id = ce.charge_id
      join policies p on p.id = c.policy_id
     where ce.kind = 'paid' and ce.provider_ref = ${input.intentId}
     limit 1
  `;

  if (!link) {
    return {
      status: 'parked',
      note: `no collected charge matches intent ${input.intentId}, refund held for matching`,
    };
  }

  const [pending] = await sql<{ id: string; total_minor: bigint }[]>`
    select r.id, r.total_minor
      from refunds r
     where r.policy_id = ${link.policy_id}::uuid
       and not exists (
         select 1 from journal_entries e
          where e.posting_key = 'refund.settled:' || r.id::text
       )
     order by r.created_at
     limit 1
  `;

  if (!pending) {
    return {
      status: 'parked',
      note: `provider refunded ${input.refundedMinor} on ${link.policy_number} with no refund booked here`,
    };
  }

  const amount = BigInt(pending.total_minor);
  const settledOn = toDate(input.occurredAt.getTime());

  const entryId = await post({
    effectiveDate: settledOn,
    eventType: 'refund.settled',
    memo: `${link.policy_number} refund settled at the processor`,
    source: 'stripe',
    sourceRef: input.intentId,
    postingKey: `refund.settled:${pending.id}`,
    policyId: link.policy_id,
    bookedAt: input.occurredAt,
    lines: [debit(ACCOUNT.refundPayable, amount), credit(ACCOUNT.cash, amount)],
  });

  return { status: 'processed', entryId, note: `refund settled on ${link.policy_number}` };
}
