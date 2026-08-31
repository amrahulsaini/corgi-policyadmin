import Link from 'next/link';
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

export default async function StaffPolicies() {
  await requireRole('staff');

  const rows = await sql<
    {
      id: string;
      policy_number: string;
      status: string;
      term_start: string;
      term_end: string;
      customer_name: string;
      broker_name: string;
      written: bigint;
      collected: bigint;
      versions: number;
    }[]
  >`
    select p.id, p.policy_number, p.status, p.term_start::text, p.term_end::text,
           c.legal_name as customer_name, b.name as broker_name,
           coalesce((select sum(amount_minor) from premium_layers where policy_id = p.id), 0) as written,
           coalesce((
             select sum(ce.amount_minor)
               from charge_events ce
               join premium_charges pc on pc.id = ce.charge_id
              where pc.policy_id = p.id and ce.kind = 'paid'
           ), 0) as collected,
           (select count(*)::int from policy_versions where policy_id = p.id) as versions
      from policies p
      join customers c on c.id = p.customer_id
      join brokers b on b.id = p.broker_id
     order by p.created_at desc
  `;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Written premium is the sum of the premium layers. Collected is what the processor actually
          settled.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            Nothing bound yet. A broker with a cleared KYB check can bind from their console.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="sheet">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Insured</th>
                <th>Broker</th>
                <th>Term</th>
                <th>Status</th>
                <th className="text-right">Written</th>
                <th className="text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/staff/policies/${r.id}`}
                      className="num font-medium text-[var(--accent)] hover:underline"
                    >
                      {r.policy_number}
                    </Link>
                    {r.versions > 1 ? (
                      <span className="ml-2 text-[11px] text-[var(--ink-faint)]">
                        {r.versions} versions
                      </span>
                    ) : null}
                  </td>
                  <td>{r.customer_name}</td>
                  <td className="text-[var(--ink-soft)]">{r.broker_name}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
