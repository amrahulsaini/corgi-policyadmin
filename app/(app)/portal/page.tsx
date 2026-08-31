import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function CustomerPortal() {
  const user = await requireRole('customer');

  const policies = await sql<
    {
      id: string;
      policy_number: string;
      status: string;
      term_start: string;
      term_end: string;
      written: bigint;
    }[]
  >`
    select p.id, p.policy_number, p.status, p.term_start::text, p.term_end::text,
           coalesce((select sum(amount_minor) from premium_layers where policy_id = p.id), 0) as written
      from policies p
     where p.customer_id = ${user.customerId}::uuid
     order by p.term_start desc
  `;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My policies</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">{user.name}</p>
      </div>

      {policies.length === 0 ? (
        <div className="card px-4 py-10 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            No policies on file yet. Your broker will appear here once cover is bound.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Status</th>
                <th>Term</th>
                <th className="text-right">Written premium</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id}>
                  <td className="num font-medium">{p.policy_number}</td>
                  <td>
                    <span className={`chip ${p.status === 'bound' ? 'chip-good' : 'chip-mute'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="num text-[var(--ink-soft)]">
                    {p.term_start} → {p.term_end}
                  </td>
                  <td className="num text-right font-medium">{format(BigInt(p.written))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
