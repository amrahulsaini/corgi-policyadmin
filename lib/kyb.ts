import { sql } from '@/lib/db';
import { createInquiry, oneTimeLink, readInquiry, mapStatus } from '@/lib/persona';

export type KybStatus = 'unverified' | 'pending' | 'approved' | 'failed';

export async function startVerification(brokerId: string): Promise<{ url: string; inquiryId: string }> {
  const [broker] = await sql<{ id: string; name: string; kyb_status: KybStatus }[]>`
    select id, name, kyb_status from brokers where id = ${brokerId}::uuid
  `;
  if (!broker) throw new Error('broker not found');
  if (broker.kyb_status === 'approved') throw new Error('this agency is already cleared');

  const inquiry = await createInquiry(`broker:${brokerId}`);
  const base = process.env.APP_URL;
  const url = await oneTimeLink(inquiry.id, base ? `${base}/broker?checked=1` : undefined);

  await recordStatus({
    brokerId,
    status: 'pending',
    providerRef: inquiry.id,
    reason: 'Verification started, waiting on the provider',
    payload: { inquiryStatus: inquiry.status },
  });

  return { url, inquiryId: inquiry.id };
}

export async function recordStatus(input: {
  brokerId: string;
  status: KybStatus;
  providerRef: string | null;
  reason: string | null;
  payload?: Record<string, string>;
}): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into kyb_events (broker_id, provider, provider_ref, status, reason, payload)
      values (${input.brokerId}::uuid, 'persona', ${input.providerRef}, ${input.status},
              ${input.reason}, ${sql.json(input.payload ?? {})}::jsonb)
    `;
    await tx`
      update brokers
         set kyb_status = ${input.status},
             kyb_provider = 'persona',
             kyb_reference = coalesce(${input.providerRef}, kyb_reference),
             kyb_checked_at = now(),
             kyb_failure_reason = ${input.status === 'failed' ? input.reason : null}
       where id = ${input.brokerId}::uuid
    `;
  });
}

export async function applyInquiryUpdate(input: {
  inquiryId: string;
  referenceId: string | null;
  personaStatus: string;
  payload?: Record<string, string>;
}): Promise<{ status: 'processed' | 'parked'; note: string }> {
  let brokerId: string | null = null;

  if (input.referenceId?.startsWith('broker:')) {
    brokerId = input.referenceId.slice('broker:'.length);
  }

  if (!brokerId) {
    const [row] = await sql<{ broker_id: string }[]>`
      select broker_id from kyb_events where provider_ref = ${input.inquiryId} limit 1
    `;
    brokerId = row?.broker_id ?? null;
  }

  if (!brokerId) {
    return { status: 'parked', note: `inquiry ${input.inquiryId} does not map to a broker here` };
  }

  const [exists] = await sql<{ id: string }[]>`select id from brokers where id = ${brokerId}::uuid`;
  if (!exists) {
    return { status: 'parked', note: `broker ${brokerId} not found, event held` };
  }

  const status = mapStatus(input.personaStatus);
  await recordStatus({
    brokerId,
    status,
    providerRef: input.inquiryId,
    reason:
      status === 'approved'
        ? 'Provider returned a pass'
        : status === 'failed'
          ? `Provider returned ${input.personaStatus}`
          : `Provider reports ${input.personaStatus}`,
    payload: input.payload,
  });

  return { status: 'processed', note: `broker moved to ${status}` };
}

export async function refreshFromProvider(brokerId: string): Promise<KybStatus> {
  const [broker] = await sql<{ kyb_reference: string | null }[]>`
    select kyb_reference from brokers where id = ${brokerId}::uuid
  `;
  if (!broker?.kyb_reference) throw new Error('no verification has been started for this agency');

  const inquiry = await readInquiry(broker.kyb_reference);
  const status = mapStatus(inquiry.status);
  await recordStatus({
    brokerId,
    status,
    providerRef: inquiry.id,
    reason: `Polled the provider directly, which reports ${inquiry.status}`,
  });
  return status;
}
