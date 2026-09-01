'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { requestApproval, thresholdMinor } from '@/lib/approvals';
import { format, abs, minor } from '@/lib/money';
import { applyEndorsement, priceEndorsement } from '@/lib/policy/endorse';
import { correctEndorsementDate } from '@/lib/policy/correct';
import type { Exposure } from '@/lib/rating';
import { loadHeader } from '@/lib/policy/view';
import { cancelPolicy, type CancelMethod } from '@/lib/policy/cancel';
import { openClaim } from '@/lib/claims';
import { verifyPayee } from '@/lib/bank/verify';

export type ActionState = { error: string | null; notice: string | null; link?: string | null };

export async function endorse(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole('staff');

  const policyId = String(form.get('policyId') ?? '');
  const effectiveDate = String(form.get('effectiveDate') ?? '');
  const limit = String(form.get('limit') ?? '');
  const deductible = String(form.get('deductible') ?? '');
  const vehicles = Number(form.get('vehicles') ?? 0);
  const squareFeet = Number(form.get('squareFeet') ?? 0);
  const description = String(form.get('description') ?? '').trim();
  const settleNow = String(form.get('settleNow') ?? '') === 'on';

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
    settleNow,
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
          settleNow: settleNow ? 'yes' : 'no',
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
      notice: `Endorsement booked. ${format(applied.pricing.proRataPremiumMinor)} premium over ${applied.pricing.daysRemaining} of ${applied.pricing.termDays} days, plus ${format(applied.pricing.surchargeTotalMinor)} in surcharges. ${applied.settlement.note}`,
      link: applied.settlement.kind === 'charge' ? applied.settlement.checkoutUrl : null,
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
      notice: `Corrected. The original entry stands untouched, a reversal was posted at ${result.preview.originalEffectiveDate}, and the re-book at ${result.preview.correctedEffectiveDate} moves premium by ${format(result.preview.differenceMinor)}. ${result.voidNote} ${result.settlement.note}`.replace(/\s+/g, ' ').trim(),
      link: result.settlement.kind === 'charge' ? result.settlement.checkoutUrl : null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Correction failed.', notice: null };
  }
}

export async function cancel(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole('staff');

  const policyId = String(form.get('policyId') ?? '');
  const effectiveDate = String(form.get('effectiveDate') ?? '');
  const method = String(form.get('method') ?? 'pro_rata') as CancelMethod;
  const reason = String(form.get('reason') ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return { error: 'Give a valid cancellation date.', notice: null };
  }
  if (!reason) return { error: 'Record why the policy is being cancelled.', notice: null };

  try {
    const result = await cancelPolicy({ policyId, effectiveDate, method, reason, actor: user.email });
    revalidatePath(`/staff/policies/${policyId}`);
    return {
      error: null,
      notice: `Cancelled. Unearned ${format(result.quote.unearnedMinor)}${result.quote.penaltyMinor > 0n ? `, short-rate penalty ${format(result.quote.penaltyMinor)} retained` : ''}, tax returned ${format(result.quote.returnedTaxMinor)}, commission clawed back ${format(result.quote.commissionClawbackMinor)}. ${result.providerNote}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Cancellation failed.', notice: null };
  }
}

export async function fileClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireRole('staff');

  const policyId = String(form.get('policyId') ?? '');
  const lossDate = String(form.get('lossDate') ?? '');
  const reportedDate = String(form.get('reportedDate') ?? '');
  const description = String(form.get('description') ?? '').trim();
  const reserve = String(form.get('reserve') ?? '');
  const payeeName = String(form.get('payeeName') ?? '').trim();

  if (!description) return { error: 'Describe the loss.', notice: null };
  if (!payeeName) return { error: 'Name the payee.', notice: null };

  try {
    const opened = await openClaim({
      policyId,
      lossDate,
      reportedDate,
      description,
      reserveMinor: minor(reserve),
      payeeName,
      actor: user.email,
    });
    const verification = await verifyPayee({ claimId: opened.claimId, payeeName });
    revalidatePath(`/staff/policies/${policyId}`);
    return {
      error: null,
      notice: `${opened.claimNumber} opened with a ${format(minor(reserve))} reserve. Bank verification via ${verification.provider}${verification.live ? ' (live)' : ' (simulated)'}: ${verification.nameMatches ? 'account holder matches, payouts unlocked' : 'name mismatch, payouts blocked'}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not open the claim.', notice: null };
  }
}
