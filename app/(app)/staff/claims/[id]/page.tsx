import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { claimPosition } from '@/lib/claims';
import { format } from '@/lib/money';
import { bankProviderIsLive } from '@/lib/bank/verify';
import ClaimActions from './claim-actions';

export const dynamic = 'force-dynamic';

export default async function ClaimDetail(props: { params: Promise<{ id: string }> }) {
  await requireRole('staff');
  const { id } = await props.params;

  const claim = await claimPosition(id);
  if (!claim) notFound();

  const events = await sql<
    {
      kind: string;
      amount_minor: bigint;
      effective_date: string;
      booked_at: string;
      memo: string;
      actor: string | null;
    }[]
  >`
    select kind, amount_minor, effective_date::text, booked_at::text, memo, actor
      from claim_events where claim_id = ${id}::uuid
     order by booked_at, id
  `;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/staff/claims" className="text-xs text-[var(--ink-faint)] hover:underline">
            ← Claims
          </Link>
          <h1 className="num text-2xl font-semibold tracking-tight mt-1">{claim.claimNumber}</h1>
          <p className="text-sm text-[var(--ink-soft)] mt-1">
            {claim.description} · loss {claim.lossDate} · reported {claim.reportedDate} · on{' '}
            <Link href={`/staff/policies/${claim.policyId}`} className="text-[var(--accent)] hover:underline">
              {claim.policyNumber}
            </Link>
          </p>
        </div>
        <span className={`chip ${claim.status === 'open' ? 'chip-warn' : 'chip-mute'}`}>
          {claim.status}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Occurrence limit" value={format(claim.limitMinor)} />
        <Figure label="Outstanding reserve" value={format(claim.reserveMinor)} />
        <Figure label="Paid to date" value={format(claim.paidMinor)} />
        <Figure label="Incurred" value={format(claim.incurredMinor)} note="paid plus reserve" />
        <Figure
          label="Limit remaining"
          value={format(claim.remainingLimitMinor)}
          note="nothing pays past this"
        />
      </div>

      <section className="card">
        <div className="px-4 py-3 border-b rule flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Payee bank account</h2>
            <p className="text-xs text-[var(--ink-soft)] mt-0.5">
              {claim.payeeName} · checked via {claim.payeeProvider ?? 'nothing yet'}
              {bankProviderIsLive() ? ' (Plaid sandbox, live)' : ' (simulator, labelled)'}
            </p>
          </div>
          <span className={`chip ${claim.payeeVerified ? 'chip-good' : 'chip-bad'}`}>
            {claim.payeeVerified ? 'verified' : 'not verified'}
          </span>
        </div>
        <div className="px-4 py-3 text-sm text-[var(--ink-soft)]">
          {claim.payeeVerified
            ? 'The account holder name agrees with the payee, so payments are permitted.'
            : 'Until the account holder matches the payee, this claim cannot pay out. That check runs in the service layer, not just in this screen.'}
        </div>
      </section>

      <ClaimActions
        claimId={claim.id}
        canPay={claim.payeeVerified && claim.status === 'open'}
        reserveLabel={format(claim.reserveMinor)}
      />

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Claim history</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Every reserve movement is an appended event. None of these rows can be edited.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>Event</th>
                <th>Effective</th>
                <th>Booked</th>
                <th className="text-right">Amount</th>
                <th>Note</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td>
                    <span className="chip chip-mute">{e.kind}</span>
                  </td>
                  <td className="num">{e.effective_date}</td>
                  <td className="num text-[var(--ink-faint)]">{e.booked_at.slice(0, 16)}</td>
                  <td
                    className={`num text-right font-medium ${BigInt(e.amount_minor) < 0n ? 'text-[var(--bad)]' : ''}`}
                  >
                    {format(BigInt(e.amount_minor))}
                  </td>
                  <td className="text-[var(--ink-soft)]">{e.memo}</td>
                  <td className="text-[11px] text-[var(--ink-faint)]">{e.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
