import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  bound: 'chip-good',
  cancelled: 'chip-bad',
  expired: 'chip-mute',
  quoted: 'chip-warn',
};

export default async function BrokerPolicies() {
  const user = await requireRole('broker');

  const rows = await sql<
    {
      id: string;
      policy_number: string;
      status: string;
      term_start: string;
      term_end: string;
      customer_name: string;
      written: bigint;
      collected: bigint;
      commission: bigint;
    }[]
  >`
    select p.id, p.policy_number, p.status, p.term_start::text, p.term_end::text,
           c.legal_name as customer_name,
           coalesce((select sum(amount_minor) from premium_layers where policy_id = p.id), 0) as written,
           coalesce((
             select sum(ce.amount_minor) from charge_events ce
               join premium_charges pc on pc.id = ce.charge_id
              where pc.policy_id = p.id and ce.kind = 'paid'
           ), 0) as collected,
           coalesce((
             select sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
               from journal_lines l
               join journal_entries e on e.id = l.entry_id
              where l.account_code = '2200' and e.policy_id = p.id
           ), 0) as commission
      from policies p
      join customers c on c.id = p.customer_id
     where p.broker_id = ${user.brokerId}::uuid
     order by p.created_at desc
  `;

  const totalCommission = rows.reduce((t, r) => t + BigInt(r.commission), 0n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Commission is earned when premium is collected, not when the policy is written. The gap
          between the two columns is business you have bound but not been paid for.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            Nothing bound yet under this agency.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Insured</th>
                <th>Term</th>
                <th>Status</th>
                <th className="text-right">Written</th>
                <th className="text-right">Collected</th>
                <th className="text-right">Commission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num font-medium">{r.policy_number}</td>
                  <td>{r.customer_name}</td>
                  <td className="num text-[var(--ink-soft)] whitespace-nowrap">
                    {r.term_start} → {r.term_end}
                  </td>
                  <td>
                    <span className={`chip ${STATUS_TONE[r.status] ?? 'chip-mute'}`}>{r.status}</span>
                  </td>
                  <td className="num text-right">{format(BigInt(r.written))}</td>
                  <td className="num text-right">
                    {BigInt(r.collected) === 0n ? (
                      <span className="text-[var(--warn)]">unpaid</span>
                    ) : (
                      format(BigInt(r.collected))
                    )}
                  </td>
                  <td className="num text-right font-medium">{format(BigInt(r.commission))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t rule">
                <td colSpan={6} className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                  Commission earned
                </td>
                <td className="num text-right px-3 py-2.5 font-semibold">
                  {format(totalCommission)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
