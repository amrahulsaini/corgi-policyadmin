'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { startVerification } from '@/lib/kyb';

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
