import postgres from 'postgres';
import { startVerification, applyInquiryUpdate } from '../lib/kyb';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const probe = postgres(url, { max: 1, prepare: false });

async function show(brokerId: string, label: string) {
  const [b] = await probe<{ name: string; kyb_status: string; kyb_reference: string | null }[]>`
    select name, kyb_status, kyb_reference from brokers where id = ${brokerId}::uuid
  `;
  console.log(`${label.padEnd(22)} ${b.name} → ${b.kyb_status}${b.kyb_reference ? ` (${b.kyb_reference})` : ''}`);
}

async function main() {
  const [broker] = await probe<{ id: string; name: string }[]>`
    select id, name from brokers where kyb_status <> 'approved' order by name limit 1
  `;
  if (!broker) throw new Error('every broker is already approved');

  await show(broker.id, 'before:');

  const started = await startVerification(broker.id);
  console.log(`\nlive Persona inquiry: ${started.inquiryId}`);
  console.log(`hosted flow:          ${started.url}`);
  await show(broker.id, 'after start:');

  const approved = await applyInquiryUpdate({
    inquiryId: started.inquiryId,
    referenceId: `broker:${broker.id}`,
    personaStatus: 'completed',
    payload: { event: 'inquiry.approved' },
  });
  console.log(`\nwebhook applied: ${approved.status} — ${approved.note}`);
  await show(broker.id, 'after approval:');

  const events = await probe<{ status: string; reason: string; occurred_at: string }[]>`
    select status, reason, occurred_at::text from kyb_events
     where broker_id = ${broker.id}::uuid order by occurred_at
  `;
  console.log('\nkyb history:');
  for (const e of events) {
    console.log(`  ${e.occurred_at.slice(0, 19)}  ${e.status.padEnd(10)} ${e.reason}`);
  }

  await probe.end();
}

main().catch(async (err) => {
  console.error(err);
  await probe.end();
  process.exit(1);
});
