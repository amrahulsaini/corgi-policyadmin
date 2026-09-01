import { redirect } from 'next/navigation';
import { currentUser, landingFor } from '@/lib/auth';
import Logo from '@/components/logo';
import LoginForm from './form';

export const dynamic = 'force-dynamic';

const DEMO = [
  { role: 'Staff', email: 'dana@corgi.test', note: 'issues, corrects, reconciles' },
  { role: 'Staff', email: 'marcus@corgi.test', note: 'second approver' },
  { role: 'Broker', email: 'sam@harbor.test', note: 'KYB approved, can bind' },
  { role: 'Broker', email: 'kim@meridian.test', note: 'KYB unverified, cannot bind' },
  { role: 'Customer', email: 'ops@loopwar.test', note: 'read-only policy view' },
];

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(landingFor(user.role));

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden lg:flex flex-col justify-between p-12 border-r rule">
        <div>
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="font-semibold tracking-tight">Corgi</span>
            <span className="text-[var(--ink-faint)]">Policy Administration</span>
          </div>
        </div>

        <div className="max-w-lg">
          <h1 className="text-3xl font-semibold tracking-tight leading-tight">
            Commercial liability, from bind to cancellation, on a ledger that cannot be edited.
          </h1>
          <p className="mt-4 text-[var(--ink-soft)] leading-relaxed">
            Every figure on every screen is summed from journal entries at read time. Corrections are
            reversals plus a re-book. The database refuses an update to a money row, and a hash chain
            proves nothing went around it.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <dt className="text-[var(--ink-faint)] text-xs uppercase tracking-wide">Ledger</dt>
            <dd className="mt-1 font-medium">Double entry, append only</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-faint)] text-xs uppercase tracking-wide">Money</dt>
            <dd className="mt-1 font-medium">USD, integer cents</dd>
          </div>
          <div>
            <dt className="text-[var(--ink-faint)] text-xs uppercase tracking-wide">History</dt>
            <dd className="mt-1 font-medium">Bitemporal</dd>
          </div>
        </dl>
      </section>

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Demo environment. Sandbox providers only, no live keys, no real money.
          </p>

          <LoginForm />

          <details className="mt-8 card overflow-hidden group">
            <summary className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] cursor-pointer select-none list-none flex items-center justify-between hover:text-[var(--ink)]">
              Demo accounts
              <span className="text-[var(--ink-faint)] group-open:rotate-90 transition-transform">
                ›
              </span>
            </summary>
            <div className="px-4 pb-4 border-t rule pt-3">
              <p className="text-xs text-[var(--ink-soft)]">
                Sandbox logins for reviewing this build. Password for all:{' '}
                <span className="num">corgi-demo-2026</span>
              </p>
              <ul className="mt-3 space-y-2">
                {DEMO.map((d) => (
                  <li key={d.email} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="num text-[var(--ink)]">{d.email}</span>
                    <span className="text-[var(--ink-faint)] text-right">{d.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}
