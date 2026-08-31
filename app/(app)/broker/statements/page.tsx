import { requireRole } from '@/lib/auth';
import { format } from '@/lib/money';
import { brokerStatement } from '@/lib/statements';

export const dynamic = 'force-dynamic';

export default async function BrokerStatements(props: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireRole('broker');
  const query = await props.searchParams;
  const month = /^\d{4}-\d{2}$/.test(query.month ?? '')
    ? (query.month as string)
    : new Date().toISOString().slice(0, 7);

  const statement = await brokerStatement(user.brokerId!, month);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Statement</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          {statement.brokerName} · commission {statement.commissionRateBps / 100}% of collected
          premium
        </p>
      </div>

      <form className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="month" className="block text-xs font-semibold mb-1.5">
            Month
          </label>
          <input
            id="month"
            name="month"
            type="month"
            defaultValue={month}
            className="field num w-48"
          />
        </div>
        <button type="submit" className="btn btn-ghost text-sm">
          Show
        </button>
        <p className="text-xs text-[var(--ink-soft)] max-w-md">
          A closed month re-runs to the same figures forever, because it is derived from immutable
          entries filtered by effective date.
        </p>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Premium collected" value={format(statement.premiumCollectedMinor)} />
        <Figure label="Commission earned" value={format(statement.commissionEarnedMinor)} />
        <Figure label="Clawed back" value={format(statement.commissionClawedBackMinor)} />
        <Figure label="Net due" value={format(statement.netDueMinor)} strong />
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">
              {statement.periodStart} to {statement.periodEnd}
            </h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Every line traces to a journal entry.
            </p>
          </div>
          <span className={`chip ${statement.tiesOut ? 'chip-good' : 'chip-bad'}`}>
            {statement.tiesOut ? 'ties to the ledger' : 'does not tie'}
          </span>
        </div>

        {statement.lines.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-[var(--ink-soft)]">
            Nothing moved in this month.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Effective</th>
                  <th>Policy</th>
                  <th>Event</th>
                  <th className="text-right">Premium collected</th>
                  <th className="text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="num">{l.effectiveDate}</td>
                    <td className="num">{l.policyNumber}</td>
                    <td>
                      <div className="font-medium">{l.eventType}</div>
                      <div className="text-[11px] text-[var(--ink-soft)]">{l.memo}</div>
                    </td>
                    <td className="num text-right">
                      {l.premiumCollectedMinor === 0n ? '—' : format(l.premiumCollectedMinor)}
                    </td>
                    <td
                      className={`num text-right font-medium ${l.commissionMinor < 0n ? 'text-[var(--bad)]' : ''}`}
                    >
                      {l.commissionMinor === 0n ? '—' : format(l.commissionMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t rule">
                  <td colSpan={3} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                    Net due to broker
                  </td>
                  <td className="num text-right px-3 py-2.5 font-semibold">
                    {format(statement.premiumCollectedMinor)}
                  </td>
                  <td className="num text-right px-3 py-2.5 font-semibold">
                    {format(statement.netDueMinor)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="px-4 py-3 border-t rule text-[11px] text-[var(--ink-soft)]">
          Commission payable on the ledger for this period:{' '}
          <span className="num">{format(statement.ledgerCommissionMinor)}</span>. Statement fingerprint{' '}
          <span className="num">{statement.fingerprint.slice(0, 32)}</span>
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </div>
      <div className={`num mt-2 font-semibold ${strong ? 'text-2xl text-[var(--accent)]' : 'text-xl'}`}>
        {value}
      </div>
    </div>
  );
}
