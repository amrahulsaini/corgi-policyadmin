import { redirect } from 'next/navigation';
import { currentUser, landingFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  redirect(user ? landingFor(user.role) : '/login');
}
