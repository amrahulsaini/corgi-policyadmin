'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { runReconciliation } from '@/lib/reconciliation';
import { monthBounds } from '@/lib/statements';

export type ReconState = { error: string | null; notice: string | null };

export async function run(_prev: ReconState, form: FormData): Promise<ReconState> {
  await requireRole('staff');
  const month = String(form.get('month') ?? '');

  try {
    const { start, end } = monthBounds(month);
    const result = await runReconciliation({ periodStart: start, periodEnd: end });
    revalidatePath('/staff/reconciliation');
    return {
      error: null,
      notice:
        result.breaks === 0
          ? `Checked ${result.checked} settled payments at the provider against this ledger. Everything agrees.`
          : `Checked ${result.checked} settled payments and found ${result.breaks} break${result.breaks === 1 ? '' : 's'}.`,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Reconciliation could not complete: ${err.message}`
          : 'Reconciliation failed.',
      notice: null,
    };
  }
}
