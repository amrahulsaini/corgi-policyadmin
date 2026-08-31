import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import KybButton from './kyb-button';

export const dynamic = 'force-dynamic';

const KYB_TONE: Record<string, string> = {
  approved: 'chip-good',
  pending: 'chip-warn',
  failed: 'chip-bad',
  unverified: 'chip-mute',
};

const KYB_COPY: Record<string, string> = {
  approved: 'Your agency is cleared to bind business.',
  pending: 'Your check is with the provider. Binding stays closed until it clears.',
  failed: 'The check did not pass. Nothing can be bound until it is resolved.',
  unverified: 'Start a business verification before you can bind any business.',
};

export default async function BrokerOverview() {
  const user = await requireRole('broker');

  const [broker] = await sql<
    { id: string; name: string; kyb_status: string; commission_rate_bps: number }[]
  >`select id, name, kyb_status, commission_rate_bps from brokers where id = ${user.brokerId}::uuid`;

  const [totals] = await sql<{ policies: number; written: bigint }[]>`
    select
      (select count(*)::int from policies where broker_id = ${user.brokerId}::uuid and status = 'bound') as policies,
      coalesce((
        select sum(pl.amount_minor) from premium_layers pl
        join policies p on p.id = pl.policy_id
        where p.broker_id = ${user.brokerId}::uuid
      ), 0) as written
  `;

  const cleared = broker.kyb_status === 'approved';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{broker.name}</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Commission {broker.commission_rate_bps / 100}% of collected premium
        </p>
      </div>

      <section className="card">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b rule">
          <div>
            <h2 className="font-semibold text-sm">Business verification</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">{KYB_COPY[broker.kyb_status]}</p>
          </div>
          <span className={`chip ${KYB_TONE[broker.kyb_status]}`}>{broker.kyb_status}</span>
        </div>
        <div className="px-4 py-3">
          {cleared ? (
            <Link href="/broker/new" className="btn btn-primary text-sm">
              Quote new business
            </Link>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled className="btn btn-primary text-sm">
                  Quote new business
                </button>
                <span className="text-xs text-[var(--ink-soft)]">
                  Binding is closed while verification is {broker.kyb_status}.
                </span>
              </div>
              <KybButton status={broker.kyb_status} />
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
            Bound policies
          </div>
          <div className="num text-2xl mt-2 font-semibold">{totals.policies}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
            Written premium
          </div>
          <div className="num text-2xl mt-2 font-semibold">{format(BigInt(totals.written))}</div>
        </div>
      </div>
    </div>
  );
}
