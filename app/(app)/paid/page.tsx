import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import Poll from './poll';

export const dynamic = 'force-dynamic';

export default async function Paid(props: { searchParams: Promise<{ policy?: string }> }) {
  const user = await requireUser();
  const { policy: policyId } = await props.searchParams;

  const [row] = policyId
    ? await sql<
        {
          policy_number: string;
          status: string;
          customer_name: string;
          term_start: string;
          term_end: string;
          collected: bigint;
          premium: bigint;
          surcharge: bigint;
          entries: number;
          commission: bigint;
        }[]
      >`
        select p.policy_number, p.status, c.legal_name as customer_name,
               p.term_start::text, p.term_end::text,
               coalesce((
                 select sum(ce.amount_minor) from charge_events ce
                   join premium_charges pc on pc.id = ce.charge_id
                  where pc.policy_id = p.id and ce.kind = 'paid'
               ), 0) as collected,
               coalesce((
                 select sum(pc.premium_minor) from premium_charges pc
                  where pc.policy_id = p.id and charge_status(pc.id) = 'paid'
               ), 0) as premium,
               coalesce((
                 select sum(pc.surcharge_minor) from premium_charges pc
                  where pc.policy_id = p.id and charge_status(pc.id) = 'paid'
               ), 0) as surcharge,
               (select count(*)::int from journal_entries where policy_id = p.id) as entries,
               coalesce((
                 select sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
                   from journal_lines l
                   join journal_entries e on e.id = l.entry_id
                  where l.account_code = '2200' and e.policy_id = p.id
               ), 0) as commission
          from policies p
          join customers c on c.id = p.customer_id
         where p.id = ${policyId}::uuid
      `
    : [];

  const settled = row ? BigInt(row.collected) > 0n : false;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {!settled && policyId ? <Poll /> : null}

      <div className="card card-lift overflow-hidden rise">
        <div
          className={`px-6 py-7 text-center border-b rule ${
            settled ? 'bg-[var(--good-soft)]' : 'bg-[var(--warn-soft)]'
          }`}
        >
          <div
            className={`stamp mx-auto w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
              settled ? 'bg-[var(--good)] text-white' : 'bg-[var(--warn)] text-white'
            }`}
          >
            {settled ? '✓' : '⋯'}
          </div>
          <h1 className="text-xl font-semibold tracking-tight mt-3">
            {settled ? 'Premium received' : 'Payment submitted'}
          </h1>
          <p className={`text-sm mt-1 ${settled ? 'text-[var(--good)]' : 'text-[var(--warn)]'}`}>
            {settled
              ? 'The signed webhook landed and the journal entries are posted.'
              : 'Waiting on the provider webhook. Nothing books until it arrives.'}
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4 border-b rule">
            <div>
              <div className="num text-lg font-semibold">{row?.policy_number ?? 'Policy'}</div>
              <div className="text-xs text-[var(--ink-soft)] mt-0.5">
                {row ? `${row.customer_name} · ${row.term_start} to ${row.term_end}` : '—'}
              </div>
            </div>
            <span className={`chip ${row?.status === 'bound' ? 'chip-good' : 'chip-mute'}`}>
              {row?.status ?? '—'}
            </span>
          </div>

          <table className="sheet mt-1">
            <tbody>
              <tr>
                <td>Premium</td>
                <td className="num text-right">{row ? format(BigInt(row.premium)) : '—'}</td>
              </tr>
              <tr>
                <td>
                  Taxes and fees
                  <div className="text-[10px] text-[var(--ink-faint)]">
                    Collected alongside, never part of the premium
                  </div>
                </td>
                <td className="num text-right align-top">
                  {row ? format(BigInt(row.surcharge)) : '—'}
                </td>
              </tr>
              <tr>
                <td className="font-semibold">Received</td>
                <td className="num text-right font-semibold">
                  {row ? format(BigInt(row.collected)) : '—'}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <Tile
              label="Commission booked"
              value={row ? format(BigInt(row.commission)) : '—'}
              note="on collection, not on binding"
            />
            <Tile
              label="Journal entries"
              value={String(row?.entries ?? 0)}
              note="every one of them balances"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t rule bg-[var(--line-soft)] flex flex-wrap gap-2">
          {user.role === 'staff' && policyId ? (
            <Link href={`/staff/policies/${policyId}`} className="btn btn-primary text-sm">
              Open the policy
            </Link>
          ) : null}
          {user.role === 'broker' && policyId ? (
            <Link href={`/broker/policies/${policyId}`} className="btn btn-primary text-sm">
              Open the policy
            </Link>
          ) : null}
          <Link
            href={user.role === 'broker' ? '/broker/policies' : '/staff/policies'}
            className="btn btn-ghost text-sm"
          >
            Back to policies
          </Link>
          {policyId ? (
            <a
              href={`/api/documents/declarations/${policyId}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost text-sm"
            >
              Declarations page
            </a>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-[var(--ink-soft)] text-center max-w-md mx-auto">
        {settled
          ? 'The browser coming back proves nothing on its own. This page reads the ledger, and the ledger only moved because Stripe delivered a signed event to the webhook endpoint.'
          : 'This page is checking every few seconds. Nothing is booked from the redirect — the money appears here only once the signed event arrives.'}
      </p>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </div>
      <div className="num text-base font-semibold mt-1">{value}</div>
      <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">{note}</div>
    </div>
  );
}
