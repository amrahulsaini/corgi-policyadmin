import type Stripe from 'stripe';
import { sql } from '@/lib/db';
import { stripe, webhookSecret } from '@/lib/stripe';
import { applyPaymentSucceeded, applyPaymentFailed, applyRefundSettled } from '@/lib/payments/apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return Response.json({ error: 'missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret());
  } catch (err) {
    await sql`
      insert into webhook_events (provider, provider_event_id, event_type, signature_valid, payload, status, error)
      values ('stripe', ${`invalid:${crypto.randomUUID()}`}, 'unknown', false, ${sql.json({ unverified_body: raw.slice(0, 4000) })}::jsonb,
              'rejected', ${err instanceof Error ? err.message : 'signature verification failed'})
      on conflict do nothing
    `;
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  const inserted = await sql<{ id: string }[]>`
    insert into webhook_events (provider, provider_event_id, event_type, signature_valid, payload)
    values ('stripe', ${event.id}, ${event.type}, true, ${sql.json(JSON.parse(raw))}::jsonb)
    on conflict (provider, provider_event_id) do nothing
    returning id
  `;

  if (inserted.length === 0) {
    return Response.json({ received: true, duplicate: true, event: event.id });
  }

  const recordId = inserted[0].id;

  try {
    const outcome = await handle(event);
    await sql`
      update webhook_events
         set status = ${outcome.status}, processed_at = now(), attempts = attempts + 1,
             error = ${outcome.note ?? null}
       where id = ${recordId}::uuid
    `;
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unhandled error';
    await sql`
      update webhook_events
         set status = 'failed', attempts = attempts + 1, error = ${message}
       where id = ${recordId}::uuid
    `;
    return Response.json({ received: true, status: 'failed', error: message }, { status: 200 });
  }
}

type Outcome = { status: 'processed' | 'parked' | 'ignored'; note?: string; entryId?: string };

async function handle(event: Stripe.Event): Promise<Outcome> {
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    return applyPaymentSucceeded({
      chargeId: intent.metadata?.charge_id ?? null,
      intentId: intent.id,
      amountMinor: BigInt(intent.amount_received ?? intent.amount),
      occurredAt: new Date(event.created * 1000),
      eventId: event.id,
    });
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    return applyPaymentFailed({
      chargeId: intent.metadata?.charge_id ?? null,
      intentId: intent.id,
      reason: intent.last_payment_error?.message ?? 'declined',
      eventId: event.id,
    });
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    return applyRefundSettled({
      intentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
      refundedMinor: BigInt(charge.amount_refunded),
      eventId: event.id,
      occurredAt: new Date(event.created * 1000),
    });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const chargeId = session.metadata?.charge_id;
    if (chargeId) {
      await sql`
        insert into charge_events (charge_id, kind, provider_ref, detail)
        select ${chargeId}::uuid, 'checkout_completed', ${session.id},
               ${sql.json({ payment_status: session.payment_status })}::jsonb
        where exists (select 1 from premium_charges where id = ${chargeId}::uuid)
      `;
    }
    return { status: 'processed', note: 'checkout session recorded, money posts on the intent' };
  }

  return { status: 'ignored', note: `no consumer for ${event.type}` };
}
