import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { chainStatus } from '@/lib/ledger/report';
import { listFlags } from '@/lib/ops';
import FirePanel from './fire-panel';

export const dynamic = 'force-dynamic';

export default async function LiveFirePage() {
  await requireRole('staff');

  const [chain, flags, planted, webhooks] = await Promise.all([
    chainStatus(),
    listFlags(),
    sql<{ id: string; memo: string; source_ref: string | null }[]>`
      select e.id, e.memo, e.source_ref
        from journal_entries e
       where e.posting_key like 'premium.collected:planted:%'
         and not exists (
           select 1 from journal_entries r where r.reverses_entry_id = e.id
         )
       order by e.seq desc
    `,
    sql<{ n: number; rejected: number }[]>`
      select count(*)::int as n,
             count(*) filter (where signature_valid = false)::int as rejected
        from webhook_events
    `,
  ]);

  const outage = flags.find((f) => f.name === 'stripe_outage');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live fire</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1 max-w-2xl">
          The scripted attacks, as buttons. Rather than describe how this system behaves when you
          replay a webhook, plant a break or pull a provider out from under it, press the button and
          watch. Everything here operates on the real deployed system and the real ledger.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Journal entries"
          value={String(chain.entries)}
          note={chain.intact ? 'hash chain intact' : `broken at ${chain.firstBreakSeq}`}
          tone={chain.intact ? 'good' : 'bad'}
        />
        <Stat
          label="Webhooks received"
          value={String(webhooks[0].n)}
          note={`${webhooks[0].rejected} rejected on signature`}
        />
        <Stat
          label="Stripe"
          value={outage?.enabled ? 'forced down' : 'reachable'}
          note={outage?.changedBy ? `last changed by ${outage.changedBy}` : 'never toggled'}
          tone={outage?.enabled ? 'bad' : 'good'}
        />
      </div>

      <FirePanel
        outageOn={outage?.enabled ?? false}
        planted={planted.map((p) => ({ id: p.id, ref: p.source_ref ?? '', memo: p.memo }))}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--ink-faint)] font-semibold">
        {label}
      </div>
      <div
        className={`num text-xl mt-2 font-semibold ${tone === 'bad' ? 'text-[var(--bad)]' : tone === 'good' ? 'text-[var(--good)]' : ''}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-[var(--ink-faint)] mt-1">{note}</div>
    </div>
  );
}
