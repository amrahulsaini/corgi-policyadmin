import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format, rateOf } from '@/lib/money';
import { dayCount, layerEarnedAsOf } from '@/lib/premium';
import { loadPolicyAsOf } from '@/lib/policy/view';
import AsOfPicker from '@/components/as-of';

export const dynamic = 'force-dynamic';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BrokerPolicyDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await requireRole('broker');
  const { id } = await props.params;
  const query = await props.searchParams;

  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.asOf ?? '') ? (query.asOf as string) : today();

  const view = await loadPolicyAsOf(id, asOf, null);
  if (!view || view.header.brokerId !== user.brokerId) notFound();

  const charges = await sql<
    {
      id: string;
      reason: string;
      total_minor: bigint;
      premium_minor: bigint;
      effective_date: string;
      status: string;
    }[]
  >`
    select c.id, c.reason, c.total_minor, c.premium_minor, c.effective_date::text,
           charge_status(c.id) as status
      from premium_charges c
     where c.policy_id = ${id}::uuid
     order by c.created_at
  `;

  const [commission] = await sql<{ v: bigint }[]>`
    select coalesce(sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end), 0) as v
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where l.account_code = '2200' and e.policy_id = ${id}::uuid
  `;

  const { header } = view;
  const termDays = dayCount(header.termStart, header.termEnd);
  const elapsed = Math.max(Math.min(dayCount(header.termStart, asOf), termDays), 0);
  const collected = charges
    .filter((c) => c.status === 'paid')
    .reduce((t, c) => t + BigInt(c.premium_minor), 0n);
  const pipeline = rateOf(view.writtenMinor, header.commissionRateBps) - BigInt(commission.v);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/broker/policies" className="text-xs text-[var(--ink-faint)] hover:underline">
            ← Policies
          </Link>
          <h1 className="num text-2xl font-semibold tracking-tight mt-1">{header.policyNumber}</h1>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            {header.customerName} · {header.productCode} · {header.stateCode} · {header.termStart} to{' '}
            {header.termEnd}
          </p>
        </div>
        <span className={`chip ${header.status === 'bound' ? 'chip-good' : 'chip-mute'}`}>
          {header.status}
        </span>
      </div>

      <AsOfPicker
        basePath="/broker/policies"
        policyId={id}
        asOf={asOf}
        termStart={header.termStart}
        termEnd={header.termEnd}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Written premium" value={format(view.writtenMinor)} />
        <Figure
          label={`Earned to ${asOf}`}
          value={format(view.earnedMinor)}
          note={`${elapsed} of ${termDays} days`}
        />
        <Figure label="Premium collected" value={format(collected)} />
        <Figure
          label="Commission earned"
          value={format(BigInt(commission.v))}
          note={
            pipeline > 0n
              ? `${format(pipeline)} more once the rest is collected`
              : `${header.commissionRateBps / 100}% of collected premium`
          }
        />
      </div>

      <div className="grid xl:grid-cols-2 gap-6 items-start">
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b rule">
            <h2 className="font-semibold text-sm">Cover as at {asOf}</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Rebuilt from the versions alone. Move the date above and this moves with it.
            </p>
          </div>
          {view.version ? (
            <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 px-4 py-4 text-sm">
              <div>
                <dt className="text-xs text-[var(--ink-faint)]">Occurrence limit</dt>
                <dd className="num mt-0.5">{format(view.version.limitMinor)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-faint)]">Deductible</dt>
                <dd className="num mt-0.5">{format(view.version.deductibleMinor)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-faint)]">Annual premium</dt>
                <dd className="num mt-0.5">{format(view.version.annualPremiumMinor)}</dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-xs text-[var(--ink-faint)]">Scheduled exposures</dt>
                <dd className="mt-1 space-y-0.5">
                  {view.version.exposures.length === 0 ? (
                    <span className="text-[var(--ink-soft)]">Nothing scheduled.</span>
                  ) : (
                    view.version.exposures.map((e, i) => (
                      <div key={i} className="text-[var(--ink-soft)]">
                        {e.kind === 'vehicle'
                          ? `${e.description} · VIN ${e.vin} · garaged ${e.garageState}`
                          : `${e.description} · ${e.squareFeet.toLocaleString()} sq ft · ${e.state}`}
                      </div>
                    ))
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
              No cover was in force on {asOf}.
            </p>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b rule">
            <h2 className="font-semibold text-sm">Documents</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Generated from the ledger at the date you choose, never transcribed.
            </p>
          </div>
          <div className="px-4 py-4 flex flex-wrap items-center gap-3">
            <a
              href={`/api/documents/declarations/${id}?asOf=${asOf}`}
              className="btn btn-ghost text-sm"
              target="_blank"
              rel="noreferrer"
            >
              Declarations page as at {asOf}
            </a>
            <span className="text-xs text-[var(--ink-soft)]">
              Change the as-of date above and the document changes with it.
            </span>
          </div>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Endorsement history</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Effective date is when it took effect. Booked is when this system learned of it. A
            correction reverses and re-books rather than editing.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="sheet">
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
                        v.kind === 'reversal'
                          ? 'chip-bad'
                          : v.kind === 'rebook'
                            ? 'chip-warn'
                            : 'chip-mute'
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

      <div className="grid xl:grid-cols-2 gap-6 items-start">
        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b rule">
            <h2 className="font-semibold text-sm">Premium layers</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Each change opens its own layer and earns across its own window.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="sheet">
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
                    <td className="num text-right font-medium">{format(layerEarnedAsOf(l, asOf))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-4 py-3 border-b rule">
            <h2 className="font-semibold text-sm">Payments</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              Commission is booked when one of these settles, not when the policy was written.
            </p>
          </div>
          {charges.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
              No charge raised against this policy.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Effective</th>
                    <th className="text-right">Premium</th>
                    <th className="text-right">Charged</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c) => (
                    <tr key={c.id}>
                      <td>{c.reason}</td>
                      <td className="num">{c.effective_date}</td>
                      <td className="num text-right">{format(BigInt(c.premium_minor))}</td>
                      <td className="num text-right">{format(BigInt(c.total_minor))}</td>
                      <td>
                        <span
                          className={`chip ${
                            c.status === 'paid'
                              ? 'chip-good'
                              : c.status === 'refunded'
                                ? 'chip-warn'
                                : c.status === 'voided'
                                  ? 'chip-mute'
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
      </div>


      <p className="text-xs text-[var(--ink-faint)]">
        Endorsements, corrections and cancellation are posted by the carrier. Ask your underwriter
        and the change appears here against the date it takes effect.
      </p>
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
