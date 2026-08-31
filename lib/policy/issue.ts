import { sql } from '@/lib/db';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post, type Posting } from '@/lib/ledger/post';
import { anniversary, type IsoDate } from '@/lib/premium';
import { rate, type Exposure } from '@/lib/rating';
import { surchargesFor, totalOf } from '@/lib/tax';
import type { Minor } from '@/lib/money';

export type IssueInput = {
  brokerId: string;
  customerId: string;
  productCode: string;
  stateCode: string;
  termStart: IsoDate;
  limitMinor: Minor;
  deductibleMinor: Minor;
  exposures: Exposure[];
  actor: string;
};

export type IssueResult = {
  policyId: string;
  policyNumber: string;
  versionId: string;
  entryId: string;
  annualPremiumMinor: Minor;
  surchargeTotalMinor: Minor;
  totalDueMinor: Minor;
  termEnd: IsoDate;
};

export async function issuePolicy(input: IssueInput): Promise<IssueResult> {
  const [broker] = await sql<{ kyb_status: string; name: string }[]>`
    select kyb_status, name from brokers where id = ${input.brokerId}::uuid
  `;
  if (!broker) throw new Error('broker not found');
  if (broker.kyb_status !== 'approved') {
    throw new Error(`broker ${broker.name} cannot bind business while KYB is ${broker.kyb_status}`);
  }

  const termEnd = anniversary(input.termStart);
  const rating = rate({
    productCode: input.productCode,
    stateCode: input.stateCode,
    limitMinor: input.limitMinor,
    deductibleMinor: input.deductibleMinor,
    exposures: input.exposures,
  });

  const surcharges = await surchargesFor(
    input.stateCode,
    rating.annualPremiumMinor,
    input.termStart,
  );
  const surchargeTotal = totalOf(surcharges);
  const totalDue = rating.annualPremiumMinor + surchargeTotal;

  let result!: IssueResult;

  await sql.begin(async (tx) => {
    const [{ nextval }] = await tx<{ nextval: bigint }[]>`select nextval('policy_number_seq')`;
    const policyNumber = `CGL-${input.stateCode}-${nextval}`;

    const [policy] = await tx<{ id: string }[]>`
      insert into policies (policy_number, broker_id, customer_id, product_code, state_code, term_start, term_end, status)
      values (${policyNumber}, ${input.brokerId}::uuid, ${input.customerId}::uuid, ${input.productCode},
              ${input.stateCode}, ${input.termStart}::date, ${termEnd}::date, 'bound')
      returning id
    `;

    const [version] = await tx<{ id: string }[]>`
      insert into policy_versions (policy_id, version_no, kind, effective_date, limit_minor,
                                   deductible_minor, annual_premium_minor, exposures, description, actor)
      values (${policy.id}::uuid, 1, 'issuance', ${input.termStart}::date,
              ${input.limitMinor.toString()}::bigint,
              ${input.deductibleMinor.toString()}::bigint,
              ${rating.annualPremiumMinor.toString()}::bigint,
              ${JSON.stringify(input.exposures)}::jsonb,
              ${`Policy issued for the term ${input.termStart} to ${termEnd}`}, ${input.actor})
      returning id
    `;

    await tx`
      insert into premium_layers (policy_id, version_id, starts_on, ends_on, amount_minor)
      values (${policy.id}::uuid, ${version.id}::uuid, ${input.termStart}::date, ${termEnd}::date,
              ${rating.annualPremiumMinor.toString()}::bigint)
    `;

    const lines: Posting[] = [
      debit(ACCOUNT.premiumReceivable, totalDue),
      credit(ACCOUNT.unearnedPremium, rating.annualPremiumMinor),
      ...surcharges.map((s) => credit(s.accountCode, s.amountMinor)),
    ];

    const entryId = await post(
      {
        effectiveDate: input.termStart,
        eventType: 'policy.issued',
        memo: `${policyNumber} bound, written premium and ${input.stateCode} surcharges billed`,
        source: 'staff',
        postingKey: `policy.issued:${policy.id}`,
        policyId: policy.id,
        brokerId: input.brokerId,
        actor: input.actor,
        lines,
      },
      tx,
    );

    await tx`
      insert into decision_events (actor, action, subject, detail)
      values (${input.actor}, 'policy.issued', ${policyNumber},
              ${JSON.stringify({
                rating: rating.components.map((c) => ({
                  label: c.label,
                  amount: c.amountMinor.toString(),
                  basis: c.basis,
                })),
                surcharges: surcharges.map((s) => ({
                  label: s.label,
                  amount: s.amountMinor.toString(),
                  refundable: s.refundable,
                })),
              })}::jsonb)
    `;

    result = {
      policyId: policy.id,
      policyNumber,
      versionId: version.id,
      entryId,
      annualPremiumMinor: rating.annualPremiumMinor,
      surchargeTotalMinor: surchargeTotal,
      totalDueMinor: totalDue,
      termEnd,
    };
  });

  return result;
}
