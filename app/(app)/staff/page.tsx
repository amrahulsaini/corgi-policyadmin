import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { chainStatus, trialBalance } from '@/lib/ledger/report';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function StaffOverview() {
  await requireRole('staff');

  const [balances, chain, counts] = await Promise.all([
    trialBalance(),
    chainStatus(),
    sql<{ policies: number; brokers_pending: number; open_claims: number; approvals: number }[]>`
      select
        (select count(*)::int from policies where status = 'bound') as policies,
        (select count(*)::int from brokers where kyb_status in ('unverified', 'pending', 'failed')) as brokers_pending,
        (select count(*)::int from claims where status = 'open') as open_claims,
        (select count(*)::int from approvals where status = 'pending') as approvals
    `,
  ]);

  const stat = counts[0];
  const debits = balances.reduce((t, r) => t + r.debitMinor, 0n);
  const credits = balances.reduce((t, r) => t + r.creditMinor, 0n);
  const posted = balances.some((r) => r.debitMinor > 0n || r.creditMinor > 0n);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Every figure below is summed from journal entries at read time. Nothing here is a stored
          balance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bound policies" value={String(stat.policies)} href="/staff/policies" />
        <Stat label="Open claims" value={String(stat.open_claims)} />
        <Stat
          label="Awaiting approval"
          value={String(stat.approvals)}
          href="/staff/approvals"
          tone={stat.approvals > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Brokers not cleared"
          value={String(stat.brokers_pending)}
          href="/staff/brokers"
          tone={stat.brokers_pending > 0 ? 'warn' : undefined}
        />
      </div>

      <section className="card">
        <div className="flex items-center justify-between px-4 py-3 border-b rule">
          <div>
            <h2 className="font-semibold text-sm">Ledger integrity</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Hash chain recomputed across every entry on load
            </p>
          </div>
          <span className={`chip ${chain.intact ? 'chip-good' : 'chip-bad'}`}>
            {chain.intact ? 'intact' : 'broken'}
          </span>
        </div>
        <div className="px-4 py-3 text-sm">
          {chain.intact ? (
            <p className="text-[var(--ink-soft)]">
              <span className="num">{chain.entries}</span> entries verified. Each links to the hash of
              the one before it.
            </p>
          ) : (
            <p className="text-[var(--bad)]">
              Chain breaks at entry <span className="num">{chain.firstBreakSeq}</span>: {chain.reason}
            </p>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Trial balance</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">All accounts, all dates</p>
        </div>

        {!posted ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-[var(--ink-soft)]">
              No entries posted yet. The chart of accounts is seeded and waiting.
            </p>
            <Link href="/staff/policies" className="btn btn-ghost mt-4 text-xs">
              Go to policies
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="text-right">Debits</th>
                  <th className="text-right">Credits</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((r) => (
                  <tr key={r.code}>
                    <td className="num text-[var(--ink-faint)]">{r.code}</td>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-[var(--ink-soft)]">{r.type}</td>
                    <td className="num text-right text-[var(--ink-soft)]">
                      {r.debitMinor === 0n ? '—' : format(r.debitMinor)}
                    </td>
                    <td className="num text-right text-[var(--ink-soft)]">
                      {r.creditMinor === 0n ? '—' : format(r.creditMinor)}
                    </td>
                    <td className="num text-right font-medium">{format(r.balanceMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t rule">
                  <td colSpan={3} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                    Total
                  </td>
                  <td className="num text-right px-3 py-2.5 font-semibold">{format(debits)}</td>
                  <td className="num text-right px-3 py-2.5 font-semibold">{format(credits)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`chip ${debits === credits ? 'chip-good' : 'chip-bad'}`}>
                      {debits === credits ? 'balanced' : 'out of balance'}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: 'warn';
}) {
  const body = (
    <div className="card p-4 h-full">
      <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </div>
      <div
        className={`num text-2xl mt-2 font-semibold ${tone === 'warn' ? 'text-[var(--warn)]' : ''}`}
      >
        {value}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-80 transition-opacity">
      {body}
    </Link>
  ) : (
    body
  );
}
