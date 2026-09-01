import { sql } from '@/lib/db';
import { post, reverse } from '@/lib/ledger/post';
import { proRataDelta, type IsoDate } from '@/lib/premium';
import { surchargesFor, totalOf } from '@/lib/tax';
import { endorsementLines, type EndorsePricing } from './endorse';
import {
  settleEndorsement,
  voidEndorsementCharge,
  type EndorsementSettlement,
} from '@/lib/payments/endorsement';
import { loadHeader } from './view';
import type { Exposure } from '@/lib/rating';

export type CorrectionInput = {
  versionId: string;
  correctedEffectiveDate: IsoDate;
  reason: string;
  actor: string;
};

export type CorrectionPreview = {
  policyNumber: string;
  originalEffectiveDate: IsoDate;
  correctedEffectiveDate: IsoDate;
  originalProRataMinor: bigint;
  correctedProRataMinor: bigint;
  differenceMinor: bigint;
  annualDeltaMinor: bigint;
};

type Target = {
  policy_id: string;
  version_no: number;
  kind: string;
  effective_date: string;
  limit_minor: bigint;
  deductible_minor: bigint;
  annual_premium_minor: bigint;
  exposures: Exposure[];
  description: string;
  prior_annual_minor: bigint;
  layer_id: string;
  layer_amount_minor: bigint;
  layer_starts_on: string;
  layer_ends_on: string;
  entry_id: string;
};

async function loadTarget(versionId: string): Promise<Target> {
  const [row] = await sql<Target[]>`
    select v.policy_id, v.version_no, v.kind, v.effective_date::text,
           v.limit_minor, v.deductible_minor, v.annual_premium_minor, v.exposures, v.description,
           coalesce((
             select pv.annual_premium_minor from policy_versions pv
              where pv.policy_id = v.policy_id and pv.version_no < v.version_no
                and pv.kind not in ('reversal')
              order by pv.version_no desc limit 1
           ), 0) as prior_annual_minor,
           l.id as layer_id, l.amount_minor as layer_amount_minor,
           l.starts_on::text as layer_starts_on, l.ends_on::text as layer_ends_on,
           e.id as entry_id
      from policy_versions v
      join premium_layers l on l.version_id = v.id
      join journal_entries e on e.posting_key = 'endorsement.booked:' || v.id::text
     where v.id = ${versionId}::uuid
  `;
  if (!row) throw new Error('no endorsement found for that version');
  if (row.kind !== 'endorsement' && row.kind !== 'rebook') {
    throw new Error(`only an endorsement can be corrected, this version is a ${row.kind}`);
  }

  const [already] = await sql<{ id: string }[]>`
    select id from policy_versions
     where reverses_version_id = ${versionId}::uuid
  `;
  if (already) throw new Error('that endorsement has already been reversed');

  return row;
}

export async function previewCorrection(input: CorrectionInput): Promise<CorrectionPreview> {
  const target = await loadTarget(input.versionId);
  const header = await loadHeader(target.policy_id);
  if (!header) throw new Error('policy not found');

  const annualDelta = BigInt(target.annual_premium_minor) - BigInt(target.prior_annual_minor);
  const corrected = proRataDelta(
    annualDelta,
    input.correctedEffectiveDate,
    header.termStart,
    header.termEnd,
  );
  const original = BigInt(target.layer_amount_minor);

  return {
    policyNumber: header.policyNumber,
    originalEffectiveDate: target.effective_date,
    correctedEffectiveDate: input.correctedEffectiveDate,
    originalProRataMinor: original,
    correctedProRataMinor: corrected,
    differenceMinor: corrected - original,
    annualDeltaMinor: annualDelta,
  };
}

export type CorrectionResult = {
  reversalVersionId: string;
  rebookVersionId: string;
  reversalEntryId: string;
  rebookEntryId: string;
  preview: CorrectionPreview;
  settlement: EndorsementSettlement;
  voidNote: string;
};

export async function correctEndorsementDate(
  input: CorrectionInput,
): Promise<CorrectionResult> {
  const target = await loadTarget(input.versionId);
  const header = await loadHeader(target.policy_id);
  if (!header) throw new Error('policy not found');

  if (
    input.correctedEffectiveDate < header.termStart ||
    input.correctedEffectiveDate >= header.termEnd
  ) {
    throw new Error(
      `the corrected date must fall inside the term ${header.termStart} to ${header.termEnd}`,
    );
  }

  const preview = await previewCorrection(input);
  const annualDelta = preview.annualDeltaMinor;
  const correctedProRata = preview.correctedProRataMinor;

  const surcharges =
    correctedProRata === 0n
      ? []
      : await surchargesFor(
          header.stateCode,
          correctedProRata,
          input.correctedEffectiveDate,
          sql,
          { includeFlatFees: false },
        );

  const pricing: EndorsePricing = {
    currentAnnualMinor: BigInt(target.prior_annual_minor),
    newAnnualMinor: BigInt(target.annual_premium_minor),
    annualDeltaMinor: annualDelta,
    proRataPremiumMinor: correctedProRata,
    surcharges,
    surchargeTotalMinor: totalOf(surcharges),
    totalMinor: correctedProRata + totalOf(surcharges),
    daysRemaining: 0,
    termDays: 0,
  };

  let reversalVersionId!: string;
  let rebookVersionId!: string;
  let reversalEntryId!: string;
  let rebookEntryId!: string;

  await sql.begin(async (tx) => {
    const [{ next_no }] = await tx<{ next_no: number }[]>`
      select coalesce(max(version_no), 0) + 1 as next_no
        from policy_versions where policy_id = ${target.policy_id}::uuid
    `;

    const [reversalVersion] = await tx<{ id: string }[]>`
      insert into policy_versions (policy_id, version_no, kind, effective_date, reverses_version_id,
                                   limit_minor, deductible_minor, annual_premium_minor, exposures,
                                   description, actor)
      values (${target.policy_id}::uuid, ${next_no}, 'reversal', ${target.effective_date}::date,
              ${input.versionId}::uuid,
              ${target.limit_minor.toString()}::bigint, ${target.deductible_minor.toString()}::bigint,
              ${target.prior_annual_minor.toString()}::bigint, ${sql.json(target.exposures)}::jsonb,
              ${`Reverses version ${target.version_no}: ${input.reason}`}, ${input.actor})
      returning id
    `;
    reversalVersionId = reversalVersion.id;

    await tx`
      insert into premium_layers (policy_id, version_id, starts_on, ends_on, amount_minor, reverses_layer_id)
      values (${target.policy_id}::uuid, ${reversalVersion.id}::uuid, ${target.layer_starts_on}::date,
              ${target.layer_ends_on}::date, ${(-BigInt(target.layer_amount_minor)).toString()}::bigint,
              ${target.layer_id}::uuid)
    `;

    reversalEntryId = await reverse(
      target.entry_id,
      {
        effectiveDate: target.effective_date,
        memo: `${header.policyNumber} version ${target.version_no} reversed: ${input.reason}`,
        actor: input.actor,
        postingKey: `endorsement.reversed:${input.versionId}`,
      },
      tx,
    );

    const [rebookVersion] = await tx<{ id: string }[]>`
      insert into policy_versions (policy_id, version_no, kind, effective_date, corrects_version_id,
                                   limit_minor, deductible_minor, annual_premium_minor, exposures,
                                   description, actor)
      values (${target.policy_id}::uuid, ${next_no + 1}, 'rebook',
              ${input.correctedEffectiveDate}::date, ${input.versionId}::uuid,
              ${target.limit_minor.toString()}::bigint, ${target.deductible_minor.toString()}::bigint,
              ${target.annual_premium_minor.toString()}::bigint, ${sql.json(target.exposures)}::jsonb,
              ${`Re-books version ${target.version_no} at ${input.correctedEffectiveDate}: ${target.description}`},
              ${input.actor})
      returning id
    `;
    rebookVersionId = rebookVersion.id;

    await tx`
      insert into premium_layers (policy_id, version_id, starts_on, ends_on, amount_minor)
      values (${target.policy_id}::uuid, ${rebookVersion.id}::uuid,
              ${input.correctedEffectiveDate}::date, ${header.termEnd}::date,
              ${correctedProRata.toString()}::bigint)
    `;

    rebookEntryId = await post(
      {
        effectiveDate: input.correctedEffectiveDate,
        eventType: 'endorsement.booked',
        memo: `${header.policyNumber} re-booked at the corrected effective date ${input.correctedEffectiveDate}`,
        source: 'staff',
        postingKey: `endorsement.booked:${rebookVersion.id}`,
        correctsEntryId: target.entry_id,
        policyId: target.policy_id,
        brokerId: header.brokerId,
        actor: input.actor,
        lines: endorsementLines(pricing),
      },
      tx,
    );

    await tx`
      insert into decision_events (actor, action, subject, detail)
      values (${input.actor}, 'endorsement.corrected', ${header.policyNumber},
              ${sql.json({
                versionCorrected: target.version_no,
                from: target.effective_date,
                to: input.correctedEffectiveDate,
                originalProRata: preview.originalProRataMinor.toString(),
                correctedProRata: correctedProRata.toString(),
                difference: preview.differenceMinor.toString(),
                reason: input.reason,
              })}::jsonb)
    `;
  });

  const voided = await voidEndorsementCharge(input.versionId);

  const settlement = await settleEndorsement({
    policyId: target.policy_id,
    versionId: rebookVersionId,
    pricing,
    effectiveDate: input.correctedEffectiveDate,
    actor: input.actor,
  });

  return {
    reversalVersionId,
    rebookVersionId,
    reversalEntryId,
    rebookEntryId,
    preview,
    settlement,
    voidNote: voided.note,
  };
}
