import postgres from 'postgres';
import { refreshFromProvider } from '../lib/kyb';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const probe = postgres(url, { max: 1, prepare: false });

async function main() {
  const rows = await probe<{ id: string; name: string; kyb_reference: string | null }[]>`
    select id, name, kyb_reference from brokers where kyb_status = 'pending'
  `;
  if (rows.length === 0) console.log('nothing pending');

  for (const b of rows) {
    const status = await refreshFromProvider(b.id);
    console.log(`${b.name} (${b.kyb_reference}) -> ${status}`);
  }

  await probe.end();
}

main().catch(async (err) => {
  console.error(err);
  await probe.end();
  process.exit(1);
});
