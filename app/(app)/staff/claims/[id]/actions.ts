'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { adjustReserve, payClaim } from '@/lib/claims';
import { verifyPayee } from '@/lib/bank/verify';
import { format, minor } from '@/lib/money';
import { sql } from '@/lib/db';

export type ClaimState = { error: string | null; notice: string | null };

export async function adjust(_prev: ClaimState, form: FormData): Promise<ClaimState> {
  const user = await requireRole('staff');
  const claimId = String(form.get('claimId') ?? '');
  const direction = String(form.get('direction') ?? 'increase');
  const amount = String(form.get('amount') ?? '');
  const memo = String(form.get('memo') ?? '').trim();
  const effectiveDate = String(form.get('effectiveDate') ?? '');

  if (!memo) return { error: 'Say why the reserve is moving.', notice: null };

  try {
    const delta = direction === 'release' ? -minor(amount) : minor(amount);
    const result = await adjustReserve({
      claimId,
      deltaMinor: delta,
      effectiveDate,
      memo,
      actor: user.email,
    });
    revalidatePath(`/staff/claims/${claimId}`);
    return {
      error: null,
      notice: `Reserve now ${format(result.reserveMinor)}. The adjustment was appended, nothing was overwritten.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Adjustment failed.', notice: null };
  }
}

export async function pay(_prev: ClaimState, form: FormData): Promise<ClaimState> {
  const user = await requireRole('staff');
  const claimId = String(form.get('claimId') ?? '');
  const amount = String(form.get('amount') ?? '');
  const memo = String(form.get('memo') ?? '').trim();
  const effectiveDate = String(form.get('effectiveDate') ?? '');

  if (!memo) return { error: 'Record what this payment settles.', notice: null };

  try {
    const result = await payClaim({
      claimId,
      amountMinor: minor(amount),
      effectiveDate,
      memo,
      actor: user.email,
    });
    revalidatePath(`/staff/claims/${claimId}`);
    return {
      error: null,
      notice: `Paid ${format(minor(amount))}. Reserve drawn down to ${format(result.remainingReserveMinor)}. The payout sits in claim clearing until the rail confirms settlement.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Payment refused.', notice: null };
  }
}

export async function reverify(_prev: ClaimState, form: FormData): Promise<ClaimState> {
  await requireRole('staff');
  const claimId = String(form.get('claimId') ?? '');

  const [claim] = await sql<{ payee_name: string | null }[]>`
    select payee_name from claims where id = ${claimId}::uuid
  `;
  if (!claim?.payee_name) return { error: 'This claim has no payee on it.', notice: null };

  try {
    const result = await verifyPayee({ claimId, payeeName: claim.payee_name });
    revalidatePath(`/staff/claims/${claimId}`);
    return {
      error: null,
      notice: `${result.provider}${result.live ? ' (live)' : ' (simulated)'} returned account holder "${result.accountHolder}", routing ${result.routingNumber}, ending ${result.accountMask}. ${result.nameMatches ? 'Match — payouts unlocked.' : 'No match — payouts stay blocked.'}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Verification failed.', notice: null };
  }
}
