'use server';

import { redirect } from 'next/navigation';
import { landingFor, signIn, signOut } from '@/lib/auth';

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!email || !password) return 'Enter an email address and a password.';

  const user = await signIn(email, password);
  if (!user) return 'Those credentials do not match an account.';

  redirect(landingFor(user.role));
}

export async function logout() {
  await signOut();
  redirect('/login');
}
