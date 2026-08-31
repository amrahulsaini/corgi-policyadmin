import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function Paid(props: { searchParams: Promise<{ policy?: string }> }) {
  const user = await requireUser();
  const { policy: policyId } = await props.searchParams;

  const [row] = policyId
    ? await sql<
        { policy_number: string; collected: bigint; status: string; entries: number }[]
      >`
        select p.policy_number, p.status,
               coalesce((
                 select sum(ce.amount_minor) from charge_events ce
                   join premium_charges pc on pc.id = ce.charge_id
                  where pc.policy_id = p.id and ce.kind = 'paid'
               ), 0) as collected,
               (select count(*)::int from journal_entries where policy_id = p.id) as entries
          from policies p where p.id = ${policyId}::uuid
      `
    : [];

  const settled = row ? BigInt(row.collected) > 0n : false;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {settled ? 'Premium received' : 'Payment submitted'}
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          {row ? row.policy_number : 'Policy'} ·{' '}
          {settled
            ? 'the webhook landed and the journal entries are posted'
            : 'waiting on the provider webhook — the ledger posts when it arrives, not before'}
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <Row label="Status" value={row?.status ?? '—'} />
        <Row label="Collected" value={row ? format(BigInt(row.collected)) : '—'} />
        <Row label="Journal entries on this policy" value={String(row?.entries ?? 0)} />
      </div>

      {!settled ? (
        <p className="text-sm text-[var(--ink-soft)] bg-[var(--warn-soft)] rounded-md px-3 py-2">
          Nothing is booked from the browser coming back. The money only appears here once Stripe
          delivers the signed event to the webhook endpoint. Refresh in a moment.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {user.role === 'staff' && policyId ? (
          <Link href={`/staff/policies/${policyId}`} className="btn btn-primary text-sm">
            Open the policy
          </Link>
        ) : null}
        <Link
          href={user.role === 'broker' ? '/broker/policies' : '/staff/policies'}
          className="btn btn-ghost text-sm"
        >
          Back to policies
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}
