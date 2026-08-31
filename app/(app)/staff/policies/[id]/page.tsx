import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';
import { layerEarnedAsOf, dayCount } from '@/lib/premium';
import { loadEntries, loadPolicyAsOf } from '@/lib/policy/view';
import AsOfPicker from './as-of';

export const dynamic = 'force-dynamic';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function PolicyDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string; knownAt?: string }>;
}) {
  await requireRole('staff');
  const { id } = await props.params;
  const query = await props.searchParams;

  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.asOf ?? '') ? (query.asOf as string) : today();
  const knownAt = query.knownAt ? new Date(query.knownAt) : null;

  const view = await loadPolicyAsOf(id, asOf, knownAt);
  if (!view) notFound();

  const entries = await loadEntries(id);

  const charges = await sql<
    { id: string; reason: string; total_minor: bigint; effective_date: string; status: string }[]
  >`
    select c.id, c.reason, c.total_minor, c.effective_date::text, charge_status(c.id) as status
      from premium_charges c
     where c.policy_id = ${id}::uuid
     order by c.created_at
  `;

  const { header } = view;
  const termDays = dayCount(header.termStart, header.termEnd);
  const elapsed = Math.max(Math.min(dayCount(header.termStart, asOf), termDays), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/staff/policies" className="text-xs text-[var(--ink-faint)] hover:underline">
            ← Policies
          </Link>
          <h1 className="num text-2xl font-semibold tracking-tight mt-1">{header.policyNumber}</h1>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            {header.customerName} · {header.productCode} · {header.stateCode} · placed by{' '}
            {header.brokerName}
          </p>
        </div>
        <span className={`chip ${header.status === 'bound' ? 'chip-good' : 'chip-mute'}`}>
          {header.status}
        </span>
      </div>

      <AsOfPicker policyId={id} asOf={asOf} termStart={header.termStart} termEnd={header.termEnd} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Written premium" value={format(view.writtenMinor)} />
        <Figure
          label={`Earned to ${asOf}`}
          value={format(view.earnedMinor)}
          note={`${elapsed} of ${termDays} days`}
        />
        <Figure label="Unearned" value={format(view.unearnedMinor)} note="owed back on cancellation" />
        <Figure
          label="Occurrence limit"
          value={view.version ? format(view.version.limitMinor) : '—'}
          note={view.version ? `${format(view.version.deductibleMinor)} deductible` : undefined}
        />
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Premium layers</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Each change opens its own layer and earns across its own window. Nothing is ever
            recalculated in place.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Days</th>
                <th className="text-right">Earned at {asOf}</th>
              </tr>
            </thead>
            <tbody>
              {view.layers.map((l, i) => (
                <tr key={`${l.startsOn}-${i}`}>
                  <td className="num">{l.startsOn}</td>
                  <td className="num">{l.endsOn}</td>
                  <td className="num text-right">{format(l.amountMinor)}</td>
                  <td className="num text-right text-[var(--ink-soft)]">
                    {dayCount(l.startsOn, l.endsOn)}
                  </td>
                  <td className="num text-right font-medium">
                    {format(layerEarnedAsOf(l, asOf))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Version history</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Effective date is when it took effect. Booked is when this system learned of it.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Kind</th>
                <th>Effective</th>
                <th>Booked</th>
                <th className="text-right">Annual premium</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {view.versions.map((v) => (
                <tr key={v.id}>
                  <td className="num">{v.versionNo}</td>
                  <td>
                    <span
                      className={`chip ${
                        v.kind === 'reversal' ? 'chip-bad' : v.kind === 'rebook' ? 'chip-warn' : 'chip-mute'
                      }`}
                    >
                      {v.kind}
                    </span>
                  </td>
                  <td className="num">{v.effectiveDate}</td>
                  <td className="num text-[var(--ink-faint)]">{v.bookedAt.slice(0, 16)}</td>
                  <td className="num text-right">{format(v.annualPremiumMinor)}</td>
                  <td className="text-[var(--ink-soft)]">{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Payments</h2>
        </div>
        {charges.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
            No charge raised against this policy.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Effective</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.reason}</td>
                    <td className="num">{c.effective_date}</td>
                    <td className="num text-right">{format(BigInt(c.total_minor))}</td>
                    <td>
                      <span
                        className={`chip ${
                          c.status === 'paid'
                            ? 'chip-good'
                            : c.status === 'failed'
                              ? 'chip-bad'
                              : 'chip-warn'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Journal entries</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Every entry that touched this policy, with the lines that make it balance.
          </p>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {entries.map((e) => {
            const debits = e.lines
              .filter((l) => l.side === 'debit')
              .reduce((t, l) => t + l.amountMinor, 0n);
            return (
              <div key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num text-xs text-[var(--ink-faint)]">#{e.seq}</span>
                  <span className="font-medium text-sm">{e.eventType}</span>
                  <span className="chip chip-mute">{e.source}</span>
                  <span className="num text-xs text-[var(--ink-faint)]">
                    effective {e.effectiveDate} · booked {e.bookedAt.slice(0, 16)}
                  </span>
                  <span className="num text-sm ml-auto font-medium">{format(debits)}</span>
                </div>
                <p className="text-xs text-[var(--ink-soft)] mt-1">{e.memo}</p>
                {e.sourceRef ? (
                  <p className="num text-[11px] text-[var(--ink-faint)] mt-0.5">{e.sourceRef}</p>
                ) : null}
                <table className="grid mt-2">
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="num text-[var(--ink-faint)] w-16">{l.accountCode}</td>
                        <td>{l.accountName}</td>
                        <td className="num text-right w-28">
                          {l.side === 'debit' ? format(l.amountMinor) : ''}
                        </td>
                        <td className="num text-right w-28">
                          {l.side === 'credit' ? format(l.amountMinor) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </div>
      <div className="num text-xl mt-2 font-semibold">{value}</div>
      {note ? <div className="text-[11px] text-[var(--ink-faint)] mt-1">{note}</div> : null}
    </div>
  );
}
