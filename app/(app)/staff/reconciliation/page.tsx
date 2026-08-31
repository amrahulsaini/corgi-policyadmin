import { requireRole } from '@/lib/auth';
import { format } from '@/lib/money';
import { listBreaks, listRuns } from '@/lib/reconciliation';
import RunForm from './run-form';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  in_provider_not_ledger: 'At the provider, not here',
  in_ledger_not_provider: 'Here, not at the provider',
  amount_mismatch: 'Amounts disagree',
};

const KIND_TONE: Record<string, string> = {
  in_provider_not_ledger: 'chip-bad',
  in_ledger_not_provider: 'chip-warn',
  amount_mismatch: 'chip-bad',
};

export default async function ReconciliationPage() {
  await requireRole('staff');

  const [breaks, runs] = await Promise.all([listBreaks(), listRuns()]);
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reconciliation</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Pulls what Stripe says it settled and diffs it against what this ledger booked. Three kinds
          of disagreement, each surfaced with its age.
        </p>
      </div>

      <RunForm defaultMonth={thisMonth} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Open breaks</h2>
          {breaks.length > 0 ? (
            <span className="chip chip-bad">{breaks.length} unresolved</span>
          ) : null}
        </div>

        {breaks.length === 0 ? (
          <div className="card px-4 py-12 text-center">
            <p className="text-sm text-[var(--ink-soft)]">
              No open breaks. Either the last run agreed with the provider, or no run has happened
              yet.
            </p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Provider reference</th>
                  <th>Occurred</th>
                  <th className="text-right">Provider says</th>
                  <th className="text-right">Ledger says</th>
                  <th className="text-right">Difference</th>
                  <th className="text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((b) => {
                  const diff =
                    b.providerAmountMinor !== null && b.ledgerAmountMinor !== null
                      ? b.providerAmountMinor - b.ledgerAmountMinor
                      : null;
                  return (
                    <tr key={b.id}>
                      <td>
                        <span className={`chip ${KIND_TONE[b.kind]}`}>{KIND_LABEL[b.kind]}</span>
                        <div className="text-[11px] text-[var(--ink-soft)] mt-1 max-w-md">
                          {b.detail}
                        </div>
                      </td>
                      <td className="num text-[11px]">{b.providerReference ?? '—'}</td>
                      <td className="num">{b.occurredOn ?? '—'}</td>
                      <td className="num text-right">
                        {b.providerAmountMinor === null ? '—' : format(b.providerAmountMinor)}
                      </td>
                      <td className="num text-right">
                        {b.ledgerAmountMinor === null ? '—' : format(b.ledgerAmountMinor)}
                      </td>
                      <td className="num text-right font-medium text-[var(--bad)]">
                        {diff === null ? '—' : format(diff)}
                      </td>
                      <td className="num text-right">
                        {b.ageDays === 0 ? 'today' : `${b.ageDays}d`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Run history</h2>
        </div>
        {runs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--ink-soft)]">
            No reconciliation has been run yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Period</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th className="text-right">Checked</th>
                  <th className="text-right">Breaks</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.provider}</td>
                    <td className="num">
                      {r.periodStart} → {r.periodEnd}
                    </td>
                    <td className="num text-[var(--ink-soft)]">{r.startedAt.slice(0, 16)}</td>
                    <td>
                      <span
                        className={`chip ${r.status === 'complete' ? 'chip-good' : r.status === 'failed' ? 'chip-bad' : 'chip-warn'}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="num text-right">{r.checked}</td>
                    <td className="num text-right font-medium">{r.breakCount}</td>
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
