'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { decideApproval, SelfApprovalError } from '@/lib/approvals';

export type DecisionState = { error: string | null; notice: string | null };

export async function decide(_prev: DecisionState, form: FormData): Promise<DecisionState> {
  const user = await requireRole('staff');

  const approvalId = String(form.get('approvalId') ?? '');
  const approve = String(form.get('decision') ?? '') === 'approve';
  const note = String(form.get('note') ?? '').trim();

  try {
    const result = await decideApproval({
      approvalId,
      deciderId: user.id,
      approve,
      note: note || (approve ? 'Approved' : 'Rejected'),
    });
    revalidatePath('/staff/approvals');
    return {
      error: null,
      notice:
        result.status === 'approved'
          ? 'Approved and posted to the ledger.'
          : 'Rejected. Nothing was posted.',
    };
  } catch (err) {
    if (err instanceof SelfApprovalError) {
      return { error: err.message, notice: null };
    }
    return { error: err instanceof Error ? err.message : 'Could not record that decision.', notice: null };
  }
}
