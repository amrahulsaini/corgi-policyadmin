import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import { chainStatus, trialBalance } from '@/lib/ledger/report';

export const dynamic = 'force-dynamic';

export default async function LedgerPage(props: {
  searchParams: Promise<{ asOf?: string; knownAt?: string }>;
}) {
  await requireRole('staff');
  const query = await props.searchParams;

  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.asOf ?? '') ? (query.asOf as string) : undefined;
  const knownAt = query.knownAt ? new Date(query.knownAt) : undefined;

  const [balances, chain, entries] = await Promise.all([
    trialBalance({ asOf, knownAt }),
    chainStatus(),
    sql<
      {
        id: string;
        seq: bigint;
        effective_date: string;
        booked_at: string;
        event_type: string;
        memo: string;
        source: string;
        source_ref: string | null;
        policy_number: string | null;
        total: bigint;
        line_count: number;
      }[]
    >`
      select e.id, e.seq, e.effective_date::text, e.booked_at::text, e.event_type, e.memo,
             e.source, e.source_ref, p.policy_number,
             coalesce(sum(case when l.side = 'debit' then l.amount_minor else 0 end), 0) as total,
             count(l.id)::int as line_count
        from journal_entries e
        left join journal_lines l on l.entry_id = e.id
        left join policies p on p.id = e.policy_id
       group by e.id, e.seq, e.effective_date, e.booked_at, e.event_type, e.memo,
                e.source, e.source_ref, p.policy_number
       order by e.seq desc
       limit 100
    `,
  ]);

  const debits = balances.reduce((t, r) => t + r.debitMinor, 0n);
  const credits = balances.reduce((t, r) => t + r.creditMinor, 0n);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ledger</h1>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            {asOf ? `Balances as at ${asOf}.` : 'Balances across all dates.'} Summed from the lines on
            every read.
          </p>
        </div>
        <span className={`chip ${chain.intact ? 'chip-good' : 'chip-bad'}`}>
          chain {chain.intact ? 'intact' : 'broken'} · {chain.entries} entries
        </span>
      </div>

      <form className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="asOf" className="block text-xs font-semibold mb-1.5">
            Effective on or before
          </label>
          <input id="asOf" name="asOf" type="date" defaultValue={asOf} className="field num w-48" />
        </div>
        <div>
          <label htmlFor="knownAt" className="block text-xs font-semibold mb-1.5">
            As known at
          </label>
          <input
            id="knownAt"
            name="knownAt"
            type="datetime-local"
            defaultValue={query.knownAt}
            className="field num w-56"
          />
        </div>
        <button type="submit" className="btn btn-ghost text-sm">
          Recompute
        </button>
        <Link href="/staff/ledger" className="btn btn-ghost text-sm">
          Clear
        </Link>
        <p className="text-xs text-[var(--ink-soft)] max-w-sm">
          The second field is the bitemporal one: it rebuilds the balances as this system understood
          them at that moment, before any later correction was learned.
        </p>
      </form>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Trial balance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="sheet">
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
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Journal</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">Most recent 100 entries</p>
        </div>
        {entries.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-[var(--ink-soft)]">
            The journal is empty.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Effective</th>
                  <th>Booked</th>
                  <th>Event</th>
                  <th>Policy</th>
                  <th>Source</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num text-[var(--ink-faint)]">{Number(e.seq)}</td>
                    <td className="num">{e.effective_date}</td>
                    <td className="num text-[var(--ink-faint)]">{e.booked_at.slice(0, 16)}</td>
                    <td>
                      <div className="font-medium">{e.event_type}</div>
                      <div className="text-[11px] text-[var(--ink-soft)]">{e.memo}</div>
                    </td>
                    <td className="num">{e.policy_number ?? '—'}</td>
                    <td>
                      <span className="chip chip-mute">{e.source}</span>
                    </td>
                    <td className="num text-right font-medium">{format(BigInt(e.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
