import { sql } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import { assertStripeUp } from '@/lib/ops';
import type { Minor } from '@/lib/money';

export type BreakKind =
  | 'in_provider_not_ledger'
  | 'in_ledger_not_provider'
  | 'amount_mismatch';

export type ReconBreak = {
  id: string;
  runId: string;
  kind: BreakKind;
  providerReference: string | null;
  entryId: string | null;
  providerAmountMinor: Minor | null;
  ledgerAmountMinor: Minor | null;
  occurredOn: string | null;
  firstSeenAt: string;
  resolvedAt: string | null;
  ageDays: number;
  detail: string;
};

export type ReconRun = {
  id: string;
  provider: string;
  periodStart: string;
  periodEnd: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  checked: number;
  breakCount: number;
};

type ProviderCharge = { reference: string; amountMinor: bigint; createdOn: string };

async function fetchStripeCharges(since: Date): Promise<ProviderCharge[]> {
  await assertStripeUp();
  const out: ProviderCharge[] = [];
  const intents = await stripe.paymentIntents.list({
    created: { gte: Math.floor(since.getTime() / 1000) },
    limit: 100,
  });

  for (const intent of intents.data) {
    if (intent.status !== 'succeeded') continue;
    out.push({
      reference: intent.id,
      amountMinor: BigInt(intent.amount_received ?? intent.amount),
      createdOn: new Date(intent.created * 1000).toISOString().slice(0, 10),
    });
  }
  return out;
}

export async function runReconciliation(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<{ runId: string; checked: number; breaks: number }> {
  const [run] = await sql<{ id: string }[]>`
    insert into recon_runs (provider, period_start, period_end)
    values ('stripe', ${input.periodStart}::date, ${input.periodEnd}::date)
    returning id
  `;

  let checked = 0;
  let breaks = 0;

  try {
    const providerCharges = await fetchStripeCharges(new Date(`${input.periodStart}T00:00:00Z`));

    const ledgerRows = await sql<
      { entry_id: string; source_ref: string; amount: bigint; effective_date: string }[]
    >`
      select e.id as entry_id, e.source_ref,
             coalesce(sum(case when l.account_code = '1000' and l.side = 'debit'
                               then l.amount_minor else 0 end), 0) as amount,
             e.effective_date::text
        from journal_entries e
        join journal_lines l on l.entry_id = e.id
       where e.source = 'stripe' and e.event_type = 'premium.collected'
         and e.effective_date >= ${input.periodStart}::date
         and e.effective_date < ${input.periodEnd}::date
       group by e.id, e.source_ref, e.effective_date
    `;

    const ledgerByRef = new Map(ledgerRows.map((r) => [r.source_ref, r]));
    const providerByRef = new Map(providerCharges.map((c) => [c.reference, c]));

    for (const charge of providerCharges) {
      checked += 1;
      const ledger = ledgerByRef.get(charge.reference);

      if (!ledger) {
        breaks += 1;
        await sql`
          insert into recon_breaks (run_id, kind, provider_reference, provider_amount_minor, occurred_on, detail)
          values (${run.id}::uuid, 'in_provider_not_ledger', ${charge.reference},
                  ${charge.amountMinor.toString()}::bigint, ${charge.createdOn}::date,
                  ${`Stripe settled ${charge.reference} with nothing booked against it here.`})
        `;
        continue;
      }

      if (BigInt(ledger.amount) !== charge.amountMinor) {
        breaks += 1;
        await sql`
          insert into recon_breaks (run_id, kind, provider_reference, entry_id,
                                    provider_amount_minor, ledger_amount_minor, occurred_on, detail)
          values (${run.id}::uuid, 'amount_mismatch', ${charge.reference}, ${ledger.entry_id}::uuid,
                  ${charge.amountMinor.toString()}::bigint, ${BigInt(ledger.amount).toString()}::bigint,
                  ${charge.createdOn}::date,
                  ${`Stripe settled ${charge.amountMinor} against ${ledger.amount} booked here.`})
        `;
      }
    }

    for (const ledger of ledgerRows) {
      if (!ledger.source_ref || providerByRef.has(ledger.source_ref)) continue;
      breaks += 1;
      await sql`
        insert into recon_breaks (run_id, kind, provider_reference, entry_id,
                                  ledger_amount_minor, occurred_on, detail)
        values (${run.id}::uuid, 'in_ledger_not_provider', ${ledger.source_ref}, ${ledger.entry_id}::uuid,
                ${BigInt(ledger.amount).toString()}::bigint, ${ledger.effective_date}::date,
                ${`This ledger booked ${ledger.amount} against ${ledger.source_ref}, which the provider does not report as settled in the period.`})
      `;
    }

    await sql`
      update recon_runs set finished_at = now(), status = 'complete',
             checked = ${checked}, break_count = ${breaks}
       where id = ${run.id}::uuid
    `;
  } catch (err) {
    await sql`
      update recon_runs set finished_at = now(), status = 'failed'
       where id = ${run.id}::uuid
    `;
    throw err;
  }

  return { runId: run.id, checked, breaks };
}

export async function listBreaks(includeResolved = false): Promise<ReconBreak[]> {
  const rows = await sql<
    {
      id: string;
      run_id: string;
      kind: BreakKind;
      provider_reference: string | null;
      entry_id: string | null;
      provider_amount_minor: bigint | null;
      ledger_amount_minor: bigint | null;
      occurred_on: string | null;
      first_seen_at: string;
      resolved_at: string | null;
      age_days: number;
      detail: string;
    }[]
  >`
    select b.id, b.run_id, b.kind, b.provider_reference, b.entry_id,
           b.provider_amount_minor, b.ledger_amount_minor, b.occurred_on::text,
           b.first_seen_at::text, b.resolved_at::text,
           extract(day from now() - b.first_seen_at)::int as age_days,
           b.detail
      from recon_breaks b
     where ${includeResolved ? sql`true` : sql`b.resolved_at is null`}
     order by b.first_seen_at desc
  `;

  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    kind: r.kind,
    providerReference: r.provider_reference,
    entryId: r.entry_id,
    providerAmountMinor: r.provider_amount_minor === null ? null : BigInt(r.provider_amount_minor),
    ledgerAmountMinor: r.ledger_amount_minor === null ? null : BigInt(r.ledger_amount_minor),
    occurredOn: r.occurred_on,
    firstSeenAt: r.first_seen_at,
    resolvedAt: r.resolved_at,
    ageDays: r.age_days,
    detail: r.detail,
  }));
}

export async function listRuns(limit = 10): Promise<ReconRun[]> {
  const rows = await sql<
    {
      id: string;
      provider: string;
      period_start: string;
      period_end: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      checked: number;
      break_count: number;
    }[]
  >`
    select id, provider, period_start::text, period_end::text, started_at::text,
           finished_at::text, status, checked, break_count
      from recon_runs order by started_at desc limit ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    checked: r.checked,
    breakCount: r.break_count,
  }));
}
