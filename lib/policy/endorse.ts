import { sql } from '@/lib/db';
import type { Db } from '@/lib/db/types';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post, type Posting } from '@/lib/ledger/post';
import { abs, type Minor } from '@/lib/money';
import { dayCount, proRataDelta, type IsoDate } from '@/lib/premium';
import { rate, type Exposure } from '@/lib/rating';
import { surchargesFor, totalOf, type Surcharge } from '@/lib/tax';
import { settleEndorsement, type EndorsementSettlement } from '@/lib/payments/endorsement';
import { loadHeader } from './view';

export type EndorseInput = {
  policyId: string;
  effectiveDate: IsoDate;
  limitMinor: Minor;
  deductibleMinor: Minor;
  exposures: Exposure[];
  description: string;
  actor: string;
  settleNow?: boolean;
};

export type EndorsePricing = {
  currentAnnualMinor: Minor;
  newAnnualMinor: Minor;
  annualDeltaMinor: Minor;
  proRataPremiumMinor: Minor;
  surcharges: Surcharge[];
  surchargeTotalMinor: Minor;
  totalMinor: Minor;
  daysRemaining: number;
  termDays: number;
};

export type EndorseResult = {
  versionId: string;
  entryId: string;
  pricing: EndorsePricing;
  settlement: EndorsementSettlement;
};

export async function priceEndorsement(
  input: EndorseInput,
  tx: Db = sql,
): Promise<EndorsePricing> {
  const header = await loadHeader(input.policyId);
  if (!header) throw new Error('policy not found');
  if (header.status !== 'bound') throw new Error(`cannot endorse a ${header.status} policy`);

  if (input.effectiveDate < header.termStart || input.effectiveDate >= header.termEnd) {
    throw new Error(
      `an endorsement must take effect inside the term ${header.termStart} to ${header.termEnd}`,
    );
  }

  const [currentRow] = await tx<{ annual_premium_minor: bigint }[]>`
    select annual_premium_minor
      from policy_versions
     where policy_id = ${input.policyId}::uuid
       and kind <> 'reversal'
       and effective_date <= ${input.effectiveDate}::date
       and id not in (
         select reverses_version_id from policy_versions
          where policy_id = ${input.policyId}::uuid and reverses_version_id is not null
       )
     order by effective_date desc, booked_at desc
     limit 1
  `;
  if (!currentRow) throw new Error('policy has no standing version');

  const currentAnnual = BigInt(currentRow.annual_premium_minor);

  const rated = rate({
    productCode: header.productCode,
    stateCode: header.stateCode,
    limitMinor: input.limitMinor,
    deductibleMinor: input.deductibleMinor,
    exposures: input.exposures,
  });

  const annualDelta = rated.annualPremiumMinor - currentAnnual;
  const proRata = proRataDelta(annualDelta, input.effectiveDate, header.termStart, header.termEnd);

  const surcharges =
    proRata === 0n
      ? []
      : await surchargesFor(header.stateCode, proRata, input.effectiveDate, tx, {
          includeFlatFees: false,
        });

  const surchargeTotal = totalOf(surcharges);

  return {
    currentAnnualMinor: currentAnnual,
    newAnnualMinor: rated.annualPremiumMinor,
    annualDeltaMinor: annualDelta,
    proRataPremiumMinor: proRata,
    surcharges,
    surchargeTotalMinor: surchargeTotal,
    totalMinor: proRata + surchargeTotal,
    daysRemaining: dayCount(input.effectiveDate, header.termEnd),
    termDays: dayCount(header.termStart, header.termEnd),
  };
}

export async function applyEndorsement(input: EndorseInput): Promise<EndorseResult> {
  const header = await loadHeader(input.policyId);
  if (!header) throw new Error('policy not found');

  const pricing = await priceEndorsement(input);
  if (pricing.proRataPremiumMinor === 0n && pricing.annualDeltaMinor === 0n) {
    throw new Error('this endorsement changes nothing that carries a premium');
  }

  let versionId!: string;
  let entryId!: string;

  await sql.begin(async (tx) => {
    const [{ next_no }] = await tx<{ next_no: number }[]>`
      select coalesce(max(version_no), 0) + 1 as next_no
        from policy_versions where policy_id = ${input.policyId}::uuid
    `;

    const [version] = await tx<{ id: string }[]>`
      insert into policy_versions (policy_id, version_no, kind, effective_date, limit_minor,
                                   deductible_minor, annual_premium_minor, exposures, description, actor)
      values (${input.policyId}::uuid, ${next_no}, 'endorsement', ${input.effectiveDate}::date,
              ${input.limitMinor.toString()}::bigint, ${input.deductibleMinor.toString()}::bigint,
              ${pricing.newAnnualMinor.toString()}::bigint, ${sql.json(input.exposures)}::jsonb,
              ${input.description}, ${input.actor})
      returning id
    `;
    versionId = version.id;

    await tx`
      insert into premium_layers (policy_id, version_id, starts_on, ends_on, amount_minor)
      values (${input.policyId}::uuid, ${version.id}::uuid, ${input.effectiveDate}::date,
              ${header.termEnd}::date, ${pricing.proRataPremiumMinor.toString()}::bigint)
    `;

    entryId = await post(
      {
        effectiveDate: input.effectiveDate,
        eventType: 'endorsement.booked',
        memo: `${header.policyNumber} endorsed effective ${input.effectiveDate}: ${input.description}`,
        source: 'staff',
        postingKey: `endorsement.booked:${version.id}`,
        policyId: input.policyId,
        brokerId: header.brokerId,
        actor: input.actor,
        lines: endorsementLines(pricing),
      },
      tx,
    );

    await tx`
      insert into decision_events (actor, action, subject, detail)
      values (${input.actor}, 'endorsement.booked', ${header.policyNumber},
              ${sql.json({
                effectiveDate: input.effectiveDate,
                annualDelta: pricing.annualDeltaMinor.toString(),
                proRata: pricing.proRataPremiumMinor.toString(),
                daysRemaining: pricing.daysRemaining,
                termDays: pricing.termDays,
              })}::jsonb)
    `;
  });

  const settlement =
    input.settleNow === false
      ? held(pricing)
      : await settleEndorsement({
          policyId: input.policyId,
          versionId,
          pricing,
          effectiveDate: input.effectiveDate,
          actor: input.actor,
        });

  return { versionId, entryId, pricing, settlement };
}

function held(pricing: EndorsePricing): EndorsementSettlement {
  if (pricing.totalMinor === 0n) {
    return { kind: 'none', note: 'This endorsement moved no money, so there is nothing to settle.' };
  }
  return {
    kind: 'none',
    note:
      pricing.totalMinor > 0n
        ? 'Left unsettled at your request. It stands as a receivable until someone raises the charge.'
        : 'Left unsettled at your request. It stands as a refund payable until someone sends the money back.',
  };
}

export function endorsementLines(pricing: EndorsePricing): Posting[] {
  const premium = pricing.proRataPremiumMinor;
  const total = pricing.totalMinor;

  if (premium >= 0n) {
    return [
      debit(ACCOUNT.premiumReceivable, total),
      credit(ACCOUNT.unearnedPremium, premium),
      ...pricing.surcharges.map((s) => credit(s.accountCode, s.amountMinor)),
    ];
  }

  return [
    debit(ACCOUNT.unearnedPremium, abs(premium)),
    ...pricing.surcharges.map((s) => debit(s.accountCode, abs(s.amountMinor))),
    credit(ACCOUNT.refundPayable, abs(total)),
  ];
}
