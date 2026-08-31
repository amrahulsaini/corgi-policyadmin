import postgres from 'postgres';
import { hash } from 'bcryptjs';
import { resetSchema, runMigrations } from '../lib/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const reset = process.argv.includes('--reset');
const sql = postgres(url, { max: 1, prepare: false });

const PASSWORD = 'corgi-demo-2026';

async function main() {
  if (reset) {
    await resetSchema(sql);
    console.log('schema dropped');
  }

  const ran = await runMigrations(sql);
  console.log(ran.length ? `applied ${ran.length} migration(s)` : 'schema already current');

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  if (n > 0 && !reset) {
    console.log('users already present, refusing to double-seed without --reset');
    await sql.end();
    return;
  }

  const passwordHash = await hash(PASSWORD, 10);

  const [meridian] = await sql<{ id: string }[]>`
    insert into brokers (name, legal_name, ein, commission_rate_bps, kyb_status, kyb_provider, kyb_reference, kyb_checked_at)
    values ('Meridian Risk Partners', 'Meridian Risk Partners LLC', '84-2910573', 1500,
            'approved', 'seed', 'seed-approved', now())
    returning id
  `;

  const [harbor] = await sql<{ id: string }[]>`
    insert into brokers (name, legal_name, ein, commission_rate_bps, kyb_status)
    values ('Harbor Point Insurance Services', 'Harbor Point Insurance Services Inc', '87-1120044', 1250, 'unverified')
    returning id
  `;

  const [customer] = await sql<{ id: string }[]>`
    insert into customers (name, legal_name, email, state_code)
    values ('Sierra Freight', 'Sierra Freight Logistics LLC', 'ops@sierrafreight.test', 'CA')
    returning id
  `;

  await sql`
    insert into customers (name, legal_name, email, state_code)
    values ('Bayline Fabrication', 'Bayline Fabrication Co', 'admin@bayline.test', 'CA')
  `;

  await sql`
    insert into users (email, name, role, password_hash, broker_id, customer_id) values
      ('dana@corgi.test',   'Dana Ortiz',    'staff',    ${passwordHash}, null, null),
      ('marcus@corgi.test', 'Marcus Reyes',  'staff',    ${passwordHash}, null, null),
      ('kim@meridian.test', 'Kim Alvarez',   'broker',   ${passwordHash}, ${meridian.id}::uuid, null),
      ('sam@harbor.test',   'Sam Whitfield', 'broker',   ${passwordHash}, ${harbor.id}::uuid, null),
      ('ops@sierrafreight.test', 'Sierra Freight', 'customer', ${passwordHash}, null, ${customer.id}::uuid)
  `;

  console.log('seeded');
  console.log(`  staff   dana@corgi.test / ${PASSWORD}`);
  console.log(`  staff   marcus@corgi.test / ${PASSWORD}   (second approver)`);
  console.log(`  broker  kim@meridian.test / ${PASSWORD}   (KYB approved)`);
  console.log(`  broker  sam@harbor.test / ${PASSWORD}     (KYB unverified, cannot bind)`);
  console.log(`  customer ops@sierrafreight.test / ${PASSWORD}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
