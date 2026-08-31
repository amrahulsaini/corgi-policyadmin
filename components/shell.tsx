import Link from 'next/link';
import { logout } from '@/app/login/actions';
import type { SessionUser } from '@/lib/auth';

const NAV: Record<SessionUser['role'], { href: string; label: string }[]> = {
  staff: [
    { href: '/staff', label: 'Overview' },
    { href: '/staff/policies', label: 'Policies' },
    { href: '/staff/approvals', label: 'Approvals' },
    { href: '/staff/ledger', label: 'Ledger' },
    { href: '/staff/reconciliation', label: 'Reconciliation' },
    { href: '/staff/brokers', label: 'Brokers' },
  ],
  broker: [
    { href: '/broker', label: 'Overview' },
    { href: '/broker/policies', label: 'Policies' },
    { href: '/broker/new', label: 'New business' },
    { href: '/broker/statements', label: 'Statements' },
  ],
  customer: [
    { href: '/portal', label: 'My policies' },
    { href: '/portal/documents', label: 'Documents' },
  ],
};

export default function Shell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const nav = NAV[user.role];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b rule bg-[var(--surface)] sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-6 h-6 rounded bg-[var(--accent)]" />
            <span className="font-semibold tracking-tight text-sm">Corgi</span>
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-2.5 py-1.5 rounded-md text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)] whitespace-nowrap"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4 shrink-0">
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-[11px] text-[var(--ink-faint)] uppercase tracking-wide">
                {user.role}
              </div>
            </div>
            <form action={logout}>
              <button type="submit" className="btn btn-ghost text-xs px-2.5 py-1.5">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">{children}</main>

      <footer className="border-t rule py-4">
        <div className="max-w-[1400px] mx-auto px-6 text-xs text-[var(--ink-faint)] flex flex-wrap gap-x-6 gap-y-1">
          <span>Sandbox environment — no live keys, no real money, no real personal data</span>
          <span className="num">USD, integer cents</span>
        </div>
      </footer>
    </div>
  );
}
