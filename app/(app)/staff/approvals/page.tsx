import { requireRole } from '@/lib/auth';
import { listApprovals, thresholdMinor } from '@/lib/approvals';
import { format } from '@/lib/money';
import DecisionForm from './decision-form';

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  pending: 'chip-warn',
  approved: 'chip-good',
  rejected: 'chip-bad',
};

export default async function ApprovalsPage() {
  const user = await requireRole('staff');
  const approvals = await listApprovals();
  const pending = approvals.filter((a) => a.status === 'pending');
  const decided = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Anything above {format(thresholdMinor())} needs a second person. The database carries a
          constraint that makes approving your own request impossible, not merely discouraged.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Waiting on a decision</h2>
        {pending.length === 0 ? (
          <div className="card px-4 py-10 text-center">
            <p className="text-sm text-[var(--ink-soft)]">Nothing is waiting for approval.</p>
          </div>
        ) : (
          pending.map((a) => {
            const isOwn = a.requestedBy === user.id;
            return (
              <div key={a.id} className="card">
                <div className="px-4 py-3 border-b rule flex flex-wrap items-center gap-3">
                  <span className="chip chip-mute">{a.kind}</span>
                  <span className="num font-semibold">{format(a.amountMinor)}</span>
                  <span className="text-xs text-[var(--ink-soft)]">
                    on {String(a.payload.policyNumber ?? '—')}, effective{' '}
                    {String(a.payload.effectiveDate ?? '—')}
                  </span>
                  <span className={`chip ${TONE[a.status]} ml-auto`}>{a.status}</span>
                </div>

                <div className="px-4 py-3 text-sm">
                  <p>{String(a.payload.description ?? '')}</p>
                  <p className="text-xs text-[var(--ink-soft)] mt-1">
                    Raised by {a.requestedByName} via {a.requestedVia} on{' '}
                    <span className="num">{a.createdAt.slice(0, 16)}</span>. Threshold at the time was{' '}
                    {format(a.thresholdMinor)}.
                  </p>
                </div>

                {isOwn ? (
                  <div className="px-4 py-3 border-t rule bg-[var(--warn-soft)]">
                    <p className="text-sm text-[var(--warn)]">
                      You raised this request, so you cannot decide it. Sign in as the other staff
                      account to approve or reject.
                    </p>
                  </div>
                ) : (
                  <DecisionForm approvalId={a.id} />
                )}
              </div>
            );
          })
        )}
      </section>

      {decided.length > 0 ? (
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b rule">
            <h2 className="font-semibold text-sm">Decided</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Policy</th>
                  <th className="text-right">Amount</th>
                  <th>Raised by</th>
                  <th>Decided by</th>
                  <th>When</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((a) => (
                  <tr key={a.id}>
                    <td>{a.kind}</td>
                    <td className="num">{String(a.payload.policyNumber ?? '—')}</td>
                    <td className="num text-right">{format(a.amountMinor)}</td>
                    <td>{a.requestedByName}</td>
                    <td>{a.decidedByName ?? '—'}</td>
                    <td className="num text-[var(--ink-soft)]">{a.decidedAt?.slice(0, 16) ?? '—'}</td>
                    <td>
                      <span className={`chip ${TONE[a.status]}`}>{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
