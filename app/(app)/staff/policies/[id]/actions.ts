'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { requestApproval, thresholdMinor } from '@/lib/approvals';
import { format, abs, minor } from '@/lib/money';
import { applyEndorsement, priceEndorsement } from '@/lib/policy/endorse';
import { correctEndorsementDate } from '@/lib/policy/correct';
import type { Exposure } from '@/lib/rating';
import { loadHeader } from '@/lib/policy/view';

export type ActionState = { error: string | null; notice: string | null };

export async function endorse(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole('staff');

  const policyId = String(form.get('policyId') ?? '');
  const effectiveDate = String(form.get('effectiveDate') ?? '');
  const limit = String(form.get('limit') ?? '');
  const deductible = String(form.get('deductible') ?? '');
  const vehicles = Number(form.get('vehicles') ?? 0);
  const squareFeet = Number(form.get('squareFeet') ?? 0);
  const description = String(form.get('description') ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return { error: 'Give a valid effective date.', notice: null };
  }
  if (!description) return { error: 'Describe what this endorsement changes.', notice: null };
  if (!Number.isInteger(vehicles) || vehicles < 0 || vehicles > 50) {
    return { error: 'Scheduled vehicles must be between 0 and 50.', notice: null };
  }

  const header = await loadHeader(policyId);
  if (!header) return { error: 'Policy not found.', notice: null };

  const exposures: Exposure[] = [];
  for (let i = 0; i < vehicles; i += 1) {
    exposures.push({
      kind: 'vehicle',
      description: `Scheduled unit ${i + 1}`,
      vin: `TESTVIN${String(i + 1).padStart(10, '0')}`,
      garageState: header.stateCode,
    });
  }
  if (squareFeet > 0) {
    exposures.push({
      kind: 'location',
      description: 'Primary premises',
      squareFeet,
      state: header.stateCode,
    });
  }

  const input = {
    policyId,
    effectiveDate,
    limitMinor: minor(limit),
    deductibleMinor: minor(deductible),
    exposures,
    description,
    actor: user.email,
  };

  try {
    const pricing = await priceEndorsement(input);

    if (abs(pricing.totalMinor) > thresholdMinor()) {
      await requestApproval({
        kind: 'endorsement',
        payload: {
          policyId,
          effectiveDate,
          limitMinor: input.limitMinor.toString(),
          deductibleMinor: input.deductibleMinor.toString(),
          exposures: JSON.stringify(exposures),
          description,
          actor: user.email,
          policyNumber: header.policyNumber,
          proRataMinor: pricing.proRataPremiumMinor.toString(),
        },
        amountMinor: pricing.totalMinor,
        requestedBy: user.id,
        requestedVia: 'staff console',
      });

      revalidatePath(`/staff/policies/${policyId}`);
      return {
        error: null,
        notice: `${format(pricing.totalMinor)} is above the ${format(thresholdMinor())} threshold. Sent to the approval queue — you cannot approve your own request.`,
      };
    }

    const applied = await applyEndorsement(input);
    revalidatePath(`/staff/policies/${policyId}`);
    return {
      error: null,
      notice: `Endorsement booked. ${format(applied.pricing.proRataPremiumMinor)} premium over ${applied.pricing.daysRemaining} of ${applied.pricing.termDays} days, plus ${format(applied.pricing.surchargeTotalMinor)} in surcharges.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Endorsement failed.', notice: null };
  }
}

export async function correct(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole('staff');

  const policyId = String(form.get('policyId') ?? '');
  const versionId = String(form.get('versionId') ?? '');
  const correctedEffectiveDate = String(form.get('correctedEffectiveDate') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  if (!versionId) return { error: 'Choose the endorsement to correct.', notice: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(correctedEffectiveDate)) {
    return { error: 'Give a valid corrected effective date.', notice: null };
  }
  if (!reason) return { error: 'Record why this is being corrected.', notice: null };

  try {
    const result = await correctEndorsementDate({
      versionId,
      correctedEffectiveDate,
      reason,
      actor: user.email,
    });

    revalidatePath(`/staff/policies/${policyId}`);
    return {
      error: null,
      notice: `Corrected. The original entry stands untouched, a reversal was posted at ${result.preview.originalEffectiveDate}, and the re-book at ${result.preview.correctedEffectiveDate} moves premium by ${format(result.preview.differenceMinor)}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Correction failed.', notice: null };
  }
}
