import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

const TONE: Record<string, string> = {
  approved: 'chip-good',
  pending: 'chip-warn',
  failed: 'chip-bad',
  unverified: 'chip-mute',
};

export default async function BrokersPage() {
  await requireRole('staff');

  const brokers = await sql<
    {
      id: string;
      name: string;
      legal_name: string;
      ein: string | null;
      commission_rate_bps: number;
      kyb_status: string;
      kyb_provider: string | null;
      kyb_reference: string | null;
      kyb_checked_at: string | null;
      kyb_failure_reason: string | null;
      policies: number;
      commission_payable: bigint;
    }[]
  >`
    select b.id, b.name, b.legal_name, b.ein, b.commission_rate_bps, b.kyb_status,
           b.kyb_provider, b.kyb_reference, b.kyb_checked_at::text, b.kyb_failure_reason,
           (select count(*)::int from policies where broker_id = b.id) as policies,
           coalesce((
             select sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
               from journal_lines l
               join journal_entries e on e.id = l.entry_id
              where l.account_code = '2200' and e.broker_id = b.id
           ), 0) as commission_payable
      from brokers b
     order by b.name
  `;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brokers</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          A broker cannot bind until the agency clears a business verification check. The gate is
          enforced in the issuance service, not only in the interface.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {brokers.map((b) => (
          <div key={b.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{b.name}</h2>
                <p className="text-xs text-[var(--ink-soft)] mt-0.5">{b.legal_name}</p>
              </div>
              <span className={`chip ${TONE[b.kyb_status]}`}>{b.kyb_status}</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">EIN</dt>
                <dd className="num">{b.ein ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">
                  Commission
                </dt>
                <dd className="num">{b.commission_rate_bps / 100}% of collected</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">
                  Policies
                </dt>
                <dd className="num">{b.policies}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-[var(--ink-faint)]">
                  Commission payable
                </dt>
                <dd className="num">{format(BigInt(b.commission_payable))}</dd>
              </div>
            </dl>

            <div className="mt-4 pt-3 border-t rule text-xs text-[var(--ink-soft)]">
              {b.kyb_status === 'approved' ? (
                <>
                  Cleared{b.kyb_provider ? ` via ${b.kyb_provider}` : ''}
                  {b.kyb_checked_at ? ` on ${b.kyb_checked_at.slice(0, 10)}` : ''}. Binding is open.
                </>
              ) : b.kyb_status === 'failed' ? (
                <>Check failed: {b.kyb_failure_reason ?? 'no reason returned'}. Binding is refused.</>
              ) : b.kyb_status === 'pending' ? (
                <>Submitted and waiting on the provider. Binding stays refused until it clears.</>
              ) : (
                <>No verification started. Binding is refused.</>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
