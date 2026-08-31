'use server';

import { createHmac } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ACCOUNT } from '@/lib/ledger/accounts';
import { credit, debit, post, reverse } from '@/lib/ledger/post';
import { chainStatus } from '@/lib/ledger/report';
import { format, minor } from '@/lib/money';
import { setFlag } from '@/lib/ops';

export type FireState = { error: string | null; notice: string | null };

export async function toggleOutage(_prev: FireState, form: FormData): Promise<FireState> {
  const user = await requireRole('staff');
  const on = String(form.get('enabled') ?? '') === 'on';
  await setFlag('stripe_outage', on, user.email);
  revalidatePath('/staff/live-fire');
  return {
    error: null,
    notice: on
      ? 'Stripe is now treated as unreachable. Binding, refunds and reconciliation refuse rather than guess, and the ledger stays exactly where it is.'
      : 'Stripe restored. Nothing needed replaying, because nothing was half-written while it was down.',
  };
}

export async function plantBreak(_prev: FireState, _form: FormData): Promise<FireState> {
  const user = await requireRole('staff');

  const [policy] = await sql<{ id: string; policy_number: string; broker_id: string }[]>`
    select id, policy_number, broker_id from policies order by created_at limit 1
  `;
  if (!policy) return { error: 'Bind a policy first — there is nothing to plant against.', notice: null };

  const amount = minor('412.55');
  const bogusRef = `pi_planted_${Date.now().toString(36)}`;
  const today = new Date().toISOString().slice(0, 10);

  const entryId = await post({
    effectiveDate: today,
    eventType: 'premium.collected',
    memo: `${policy.policy_number} premium received (planted for live fire — no such payment exists at the provider)`,
    source: 'stripe',
    sourceRef: bogusRef,
    postingKey: `premium.collected:planted:${bogusRef}`,
    policyId: policy.id,
    brokerId: policy.broker_id,
    actor: user.email,
    lines: [debit(ACCOUNT.cash, amount), credit(ACCOUNT.premiumReceivable, amount)],
  });

  revalidatePath('/staff/live-fire');
  return {
    error: null,
    notice: `Booked ${format(amount)} against ${bogusRef}, which Stripe has never heard of. Run reconciliation for this month and it will surface as "here, not at the provider". Entry ${entryId.slice(0, 8)}.`,
  };
}

export async function correctPlanted(_prev: FireState, form: FormData): Promise<FireState> {
  const user = await requireRole('staff');
  const entryId = String(form.get('entryId') ?? '');

  try {
    const reversalId = await reverse(entryId, {
      memo: 'Reverses a booking that the provider never settled, found by reconciliation',
      actor: user.email,
      postingKey: `recon.corrected:${entryId}`,
    });

    await sql`
      update recon_breaks set resolved_at = now(), resolution_entry_id = ${reversalId}::uuid
       where entry_id = ${entryId}::uuid and resolved_at is null
    `;

    revalidatePath('/staff/live-fire');
    revalidatePath('/staff/reconciliation');
    return {
      error: null,
      notice:
        'Reversal posted and the break closed. The mistaken entry is still in the journal — it has to be, and that is the point.',
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not correct that.', notice: null };
  }
}

export async function replayWebhook(_prev: FireState, _form: FormData): Promise<FireState> {
  await requireRole('staff');

  const [event] = await sql<{ payload: unknown; provider_event_id: string }[]>`
    select payload, provider_event_id from webhook_events
     where provider = 'stripe' and signature_valid = true
     order by received_at desc limit 1
  `;
  if (!event) return { error: 'No Stripe webhook has been received yet.', notice: null };

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const base = process.env.APP_URL;
  if (!secret || !base) return { error: 'Webhook secret or app URL is not configured.', notice: null };

  const body = JSON.stringify(event.payload);
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

  const before = await entryCount();

  const response = await fetch(`${base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${signature}` },
    body,
  });
  const result = (await response.json()) as { duplicate?: boolean; status?: string };

  const after = await entryCount();
  revalidatePath('/staff/live-fire');

  return {
    error: null,
    notice: `Replayed ${event.provider_event_id} with a freshly computed valid signature. Response: ${result.duplicate ? 'duplicate, ignored' : (result.status ?? 'processed')}. Journal entries before ${before}, after ${after} — ${before === after ? 'nothing double-posted' : 'ENTRIES CHANGED, investigate'}.`,
  };
}

export async function forgeWebhook(_prev: FireState, _form: FormData): Promise<FireState> {
  await requireRole('staff');
  const base = process.env.APP_URL;
  if (!base) return { error: 'App URL is not configured.', notice: null };

  const response = await fetch(`${base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify({ id: 'evt_forged', type: 'payment_intent.succeeded', data: { object: {} } }),
  });

  return {
    error: null,
    notice: `Sent an unsigned event. The endpoint answered ${response.status} and recorded the attempt with signature_valid = false, so a rejected delivery is still auditable.`,
  };
}

export async function tamperTest(_prev: FireState, _form: FormData): Promise<FireState> {
  await requireRole('staff');

  let updateResult = 'no error — this would be a serious problem';
  let deleteResult = 'no error — this would be a serious problem';

  try {
    await sql.begin(async (tx) => {
      await tx`update journal_lines set amount_minor = 1 where true`;
    });
  } catch (err) {
    updateResult = err instanceof Error ? err.message.split('\n')[0] : 'refused';
  }

  try {
    await sql.begin(async (tx) => {
      await tx`delete from journal_entries where true`;
    });
  } catch (err) {
    deleteResult = err instanceof Error ? err.message.split('\n')[0] : 'refused';
  }

  const chain = await chainStatus();

  return {
    error: null,
    notice: `UPDATE → ${updateResult}. DELETE → ${deleteResult}. Chain across ${chain.entries} entries: ${chain.intact ? 'intact' : `BROKEN at ${chain.firstBreakSeq}`}.`,
  };
}

async function entryCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from journal_entries`;
  return row.n;
}
