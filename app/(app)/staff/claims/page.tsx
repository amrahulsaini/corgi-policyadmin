import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listClaims } from '@/lib/claims';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ClaimsPage() {
  await requireRole('staff');
  const claims = await listClaims();

  const totals = claims.reduce(
    (t, c) => ({
      reserve: t.reserve + c.reserveMinor,
      paid: t.paid + c.paidMinor,
      incurred: t.incurred + c.incurredMinor,
    }),
    { reserve: 0n, paid: 0n, incurred: 0n },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Claims</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          A reserve is an estimate that moves. Payments draw it down. Incurred is paid plus what is
          still held.
        </p>
      </div>

      {claims.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            No claims yet. Open one from a policy.
          </p>
          <Link href="/staff/policies" className="btn btn-ghost mt-4 text-xs">
            Go to policies
          </Link>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Policy</th>
                <th>Loss date</th>
                <th>Status</th>
                <th>Payee</th>
                <th className="text-right">Reserve</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Incurred</th>
                <th className="text-right">Limit left</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`/staff/claims/${c.id}`}
                      className="num font-medium text-[var(--accent)] hover:underline"
                    >
                      {c.claimNumber}
                    </Link>
                  </td>
                  <td className="num">{c.policyNumber}</td>
                  <td className="num">{c.lossDate}</td>
                  <td>
                    <span className={`chip ${c.status === 'open' ? 'chip-warn' : 'chip-mute'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div>{c.payeeName}</div>
                    <span className={`chip ${c.payeeVerified ? 'chip-good' : 'chip-bad'}`}>
                      {c.payeeVerified ? 'bank verified' : 'unverified'}
                    </span>
                  </td>
                  <td className="num text-right">{format(c.reserveMinor)}</td>
                  <td className="num text-right">{format(c.paidMinor)}</td>
                  <td className="num text-right font-medium">{format(c.incurredMinor)}</td>
                  <td className="num text-right text-[var(--ink-soft)]">
                    {format(c.remainingLimitMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t rule">
                <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  Total
                </td>
                <td className="num text-right px-3 py-2.5 font-semibold">{format(totals.reserve)}</td>
                <td className="num text-right px-3 py-2.5 font-semibold">{format(totals.paid)}</td>
                <td className="num text-right px-3 py-2.5 font-semibold">{format(totals.incurred)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
