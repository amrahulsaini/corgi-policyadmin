'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { startVerification, refreshFromProvider } from '@/lib/kyb';

export type KybState = { error: string | null };

export async function beginKyb(_prev: KybState, _form: FormData): Promise<KybState> {
  const user = await requireRole('broker');
  if (!user.brokerId) return { error: 'This login is not attached to an agency.' };

  let url: string;
  try {
    const started = await startVerification(user.brokerId);
    url = started.url;
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Could not reach the verification provider: ${err.message}`
          : 'Could not start verification.',
    };
  }

  redirect(url);
}

export async function checkKybNow(_prev: KybState, _form: FormData): Promise<KybState> {
  const user = await requireRole('broker');
  if (!user.brokerId) return { error: 'This login is not attached to an agency.' };

  try {
    const status = await refreshFromProvider(user.brokerId);
    revalidatePath('/broker');
    return {
      error:
        status === 'approved'
          ? null
          : `The provider still reports ${status}. Polling is the fallback here — the webhook is the design.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reach the provider.' };
  }
}
