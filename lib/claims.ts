import { sql } from '@/lib/db';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post } from '@/lib/ledger/post';
import type { Minor } from '@/lib/money';
import type { IsoDate } from '@/lib/premium';
import { loadHeader } from '@/lib/policy/view';

export type ClaimPosition = {
  id: string;
  claimNumber: string;
  policyId: string;
  policyNumber: string;
  status: string;
  lossDate: IsoDate;
  reportedDate: IsoDate;
  description: string;
  limitMinor: Minor;
  reserveMinor: Minor;
  paidMinor: Minor;
  incurredMinor: Minor;
  remainingLimitMinor: Minor;
  payeeName: string | null;
  payeeVerified: boolean;
  payeeProvider: string | null;
};

export async function coverEndsOn(policyId: string, termEnd: IsoDate): Promise<IsoDate> {
  const [cancelled] = await sql<{ effective_date: string }[]>`
    select effective_date::text from policy_versions
     where policy_id = ${policyId}::uuid and kind = 'cancellation'
     order by effective_date limit 1
  `;
  if (!cancelled) return termEnd;
  return cancelled.effective_date < termEnd ? cancelled.effective_date : termEnd;
}

export async function openClaim(input: {
  policyId: string;
  lossDate: IsoDate;
  reportedDate: IsoDate;
  description: string;
  reserveMinor: Minor;
  payeeName: string;
  actor: string;
}): Promise<{ claimId: string; claimNumber: string; entryId: string }> {
  const header = await loadHeader(input.policyId);
  if (!header) throw new Error('policy not found');

  const coverEnd = await coverEndsOn(input.policyId, header.termEnd);

  if (input.lossDate < header.termStart || input.lossDate >= coverEnd) {
    throw new Error(
      coverEnd === header.termEnd
        ? `a loss on ${input.lossDate} falls outside the term ${header.termStart} to ${header.termEnd}`
        : `cover on this policy ran ${header.termStart} to ${coverEnd}, when it was cancelled. A loss on ${input.lossDate} is outside it. Losses before that date can still be claimed.`,
    );
  }
  if (input.reserveMinor <= 0n) throw new Error('an opening reserve must be positive');

  const [version] = await sql<{ limit_minor: bigint }[]>`
    select limit_minor from policy_versions
     where policy_id = ${input.policyId}::uuid and effective_date <= ${input.lossDate}::date
     order by effective_date desc, booked_at desc limit 1
  `;
  if (!version) throw new Error('no policy version was in force on the loss date');

  const limit = BigInt(version.limit_minor);
  if (input.reserveMinor > limit) {
    throw new Error(`a reserve of ${input.reserveMinor} exceeds the ${limit} occurrence limit`);
  }

  let claimId!: string;
  let claimNumber!: string;
  let entryId!: string;

  await sql.begin(async (tx) => {
    const [{ nextval }] = await tx<{ nextval: bigint }[]>`select nextval('claim_number_seq')`;
    claimNumber = `CLM-${nextval}`;

    const [claim] = await tx<{ id: string }[]>`
      insert into claims (claim_number, policy_id, loss_date, reported_date, description, payee_name)
      values (${claimNumber}, ${input.policyId}::uuid, ${input.lossDate}::date,
              ${input.reportedDate}::date, ${input.description}, ${input.payeeName})
      returning id
    `;
    claimId = claim.id;

    entryId = await post(
      {
        effectiveDate: input.reportedDate,
        eventType: 'claim.reserved',
        memo: `${claimNumber} opened on ${header.policyNumber}, reserve established`,
        source: 'staff',
        postingKey: `claim.reserved:${claim.id}`,
        policyId: input.policyId,
        claimId: claim.id,
        brokerId: header.brokerId,
        actor: input.actor,
        lines: [
          debit(ACCOUNT.claimExpense, input.reserveMinor),
          credit(ACCOUNT.claimReserve, input.reserveMinor),
        ],
      },
      tx,
    );

    await tx`
      insert into claim_events (claim_id, kind, amount_minor, effective_date, memo, actor, entry_id)
      values (${claim.id}::uuid, 'reserve_set', ${input.reserveMinor.toString()}::bigint,
              ${input.reportedDate}::date, ${'Opening reserve'}, ${input.actor}, ${entryId}::uuid)
    `;
  });

  return { claimId, claimNumber, entryId };
}

export async function adjustReserve(input: {
  claimId: string;
  deltaMinor: Minor;
  effectiveDate: IsoDate;
  memo: string;
  actor: string;
}): Promise<{ entryId: string; reserveMinor: Minor }> {
  const position = await claimPosition(input.claimId);
  if (!position) throw new Error('claim not found');
  if (position.status !== 'open') throw new Error(`this claim is ${position.status}`);
  if (input.deltaMinor === 0n) throw new Error('an adjustment of zero changes nothing');

  const newReserve = position.reserveMinor + input.deltaMinor;
  if (newReserve < 0n) {
    throw new Error(`that adjustment would take the reserve below zero`);
  }
  if (position.paidMinor + newReserve > position.limitMinor) {
    throw new Error(
      `incurred would reach ${position.paidMinor + newReserve} against a ${position.limitMinor} limit`,
    );
  }

  const up = input.deltaMinor > 0n;
  const amount = up ? input.deltaMinor : -input.deltaMinor;

  const entryId = await post({
    effectiveDate: input.effectiveDate,
    eventType: 'claim.reserve_adjusted',
    memo: `${position.claimNumber} reserve ${up ? 'increased' : 'released'}: ${input.memo}`,
    source: 'staff',
    postingKey: `claim.reserve_adjusted:${input.claimId}:${input.effectiveDate}:${input.deltaMinor}`,
    policyId: position.policyId,
    claimId: input.claimId,
    actor: input.actor,
    lines: up
      ? [debit(ACCOUNT.claimExpense, amount), credit(ACCOUNT.claimReserve, amount)]
      : [debit(ACCOUNT.claimReserve, amount), credit(ACCOUNT.claimExpense, amount)],
  });

  await sql`
    insert into claim_events (claim_id, kind, amount_minor, effective_date, memo, actor, entry_id)
    values (${input.claimId}::uuid, 'reserve_adjusted', ${input.deltaMinor.toString()}::bigint,
            ${input.effectiveDate}::date, ${input.memo}, ${input.actor}, ${entryId}::uuid)
  `;

  return { entryId, reserveMinor: newReserve };
}

export async function payClaim(input: {
  claimId: string;
  amountMinor: Minor;
  effectiveDate: IsoDate;
  memo: string;
  actor: string;
}): Promise<{ entryId: string; remainingReserveMinor: Minor }> {
  const position = await claimPosition(input.claimId);
  if (!position) throw new Error('claim not found');
  if (position.status !== 'open') throw new Error(`this claim is ${position.status}`);
  if (input.amountMinor <= 0n) throw new Error('a payment must be positive');
  if (!position.payeeVerified) {
    throw new Error('the payee bank account has not been verified, so nothing can be paid out');
  }
  if (input.amountMinor > position.reserveMinor) {
    throw new Error(
      `a payment of ${input.amountMinor} exceeds the ${position.reserveMinor} standing reserve — raise the reserve first`,
    );
  }
  if (position.paidMinor + input.amountMinor > position.limitMinor) {
    throw new Error(
      `paying ${input.amountMinor} would take total paid past the ${position.limitMinor} occurrence limit`,
    );
  }

  const entryId = await post({
    effectiveDate: input.effectiveDate,
    eventType: 'claim.paid',
    memo: `${position.claimNumber} payment issued: ${input.memo}`,
    source: 'system',
    postingKey: `claim.paid:${input.claimId}:${input.effectiveDate}:${input.amountMinor}`,
    policyId: position.policyId,
    claimId: input.claimId,
    actor: input.actor,
    lines: [
      debit(ACCOUNT.claimReserve, input.amountMinor),
      credit(ACCOUNT.claimClearing, input.amountMinor),
    ],
  });

  await sql`
    insert into claim_events (claim_id, kind, amount_minor, effective_date, memo, actor, entry_id)
    values (${input.claimId}::uuid, 'payment', ${input.amountMinor.toString()}::bigint,
            ${input.effectiveDate}::date, ${input.memo}, ${input.actor}, ${entryId}::uuid)
  `;

  return { entryId, remainingReserveMinor: position.reserveMinor - input.amountMinor };
}

export async function claimPosition(claimId: string): Promise<ClaimPosition | null> {
  const [row] = await sql<
    {
      id: string;
      claim_number: string;
      policy_id: string;
      policy_number: string;
      status: string;
      loss_date: string;
      reported_date: string;
      description: string;
      payee_name: string | null;
      payee_account_verified: boolean;
      payee_provider: string | null;
      limit_minor: bigint;
      reserve_set: bigint;
      paid: bigint;
    }[]
  >`
    select c.id, c.claim_number, c.policy_id, p.policy_number, c.status,
           c.loss_date::text, c.reported_date::text, c.description,
           c.payee_name, c.payee_account_verified, c.payee_provider,
           coalesce((
             select v.limit_minor from policy_versions v
              where v.policy_id = c.policy_id and v.effective_date <= c.loss_date
              order by v.effective_date desc, v.booked_at desc limit 1
           ), 0) as limit_minor,
           coalesce((
             select sum(ce.amount_minor) from claim_events ce
              where ce.claim_id = c.id and ce.kind in ('reserve_set', 'reserve_adjusted')
           ), 0) as reserve_set,
           coalesce((
             select sum(ce.amount_minor) from claim_events ce
              where ce.claim_id = c.id and ce.kind = 'payment'
           ), 0) as paid
      from claims c
      join policies p on p.id = c.policy_id
     where c.id = ${claimId}::uuid
  `;
  if (!row) return null;

  const limit = BigInt(row.limit_minor);
  const reserveSet = BigInt(row.reserve_set);
  const paid = BigInt(row.paid);
  const reserve = reserveSet - paid;

  return {
    id: row.id,
    claimNumber: row.claim_number,
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    status: row.status,
    lossDate: row.loss_date,
    reportedDate: row.reported_date,
    description: row.description,
    limitMinor: limit,
    reserveMinor: reserve,
    paidMinor: paid,
    incurredMinor: paid + reserve,
    remainingLimitMinor: limit - (paid + reserve),
    payeeName: row.payee_name,
    payeeVerified: row.payee_account_verified,
    payeeProvider: row.payee_provider,
  };
}

export async function listClaims(policyId?: string): Promise<ClaimPosition[]> {
  const rows = await sql<{ id: string }[]>`
    select c.id from claims c
     where ${policyId ? sql`c.policy_id = ${policyId}::uuid` : sql`true`}
     order by c.created_at desc
  `;
  const out: ClaimPosition[] = [];
  for (const r of rows) {
    const p = await claimPosition(r.id);
    if (p) out.push(p);
  }
  return out;
}
