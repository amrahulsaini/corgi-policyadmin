import { sql } from '@/lib/db';
import { verifySignature } from '@/lib/persona';
import { applyInquiryUpdate } from '@/lib/kyb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PersonaEvent = {
  data?: {
    id?: string;
    attributes?: {
      name?: string;
      payload?: {
        data?: {
          id?: string;
          type?: string;
          attributes?: { status?: string; 'reference-id'?: string | null };
        };
      };
    };
  };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('persona-signature');

  if (!verifySignature(raw, signature)) {
    await sql`
      insert into webhook_events (provider, provider_event_id, event_type, signature_valid, payload, status, error)
      values ('persona', ${`invalid:${crypto.randomUUID()}`}, 'unknown', false,
              ${sql.json({ unverified_body: raw.slice(0, 4000) })}::jsonb,
              'rejected', 'signature verification failed')
      on conflict do nothing
    `;
    return Response.json({ error: 'signature verification failed' }, { status: 400 });
  }

  const event = JSON.parse(raw) as PersonaEvent;
  const eventId = event.data?.id ?? crypto.randomUUID();
  const eventName = event.data?.attributes?.name ?? 'unknown';

  const inserted = await sql<{ id: string }[]>`
    insert into webhook_events (provider, provider_event_id, event_type, signature_valid, payload)
    values ('persona', ${eventId}, ${eventName}, true, ${sql.json(JSON.parse(raw))}::jsonb)
    on conflict (provider, provider_event_id) do nothing
    returning id
  `;

  if (inserted.length === 0) {
    return Response.json({ received: true, duplicate: true, event: eventId });
  }

  const recordId = inserted[0].id;

  try {
    const inner = event.data?.attributes?.payload?.data;
    if (inner?.type !== 'inquiry' || !inner.id) {
      await sql`
        update webhook_events set status = 'ignored', processed_at = now(), attempts = attempts + 1,
               error = ${`no consumer for ${eventName}`}
         where id = ${recordId}::uuid
      `;
      return Response.json({ received: true, status: 'ignored' });
    }

    const outcome = await applyInquiryUpdate({
      inquiryId: inner.id,
      referenceId: inner.attributes?.['reference-id'] ?? null,
      personaStatus: inner.attributes?.status ?? 'unknown',
      payload: { event: eventName },
    });

    await sql`
      update webhook_events set status = ${outcome.status}, processed_at = now(),
             attempts = attempts + 1, error = ${outcome.note}
       where id = ${recordId}::uuid
    `;

    return Response.json({ received: true, ...outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unhandled error';
    await sql`
      update webhook_events set status = 'failed', attempts = attempts + 1, error = ${message}
       where id = ${recordId}::uuid
    `;
    return Response.json({ received: true, status: 'failed', error: message });
  }
}
