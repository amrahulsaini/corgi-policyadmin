import postgres from 'postgres';
import { hash } from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const [name, legalName, email, ein, rateBps] = process.argv.slice(2);
if (!name || !legalName || !email || !ein || !rateBps) {
  console.error('usage: add-broker <name> <legal name> <email> <ein> <commission bps> [password]');
  process.exit(1);
}

const password = process.argv[7] ?? 'corgi-demo-2026';
const sql = postgres(url, { max: 1, prepare: false });

async function main() {
  const [existing] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (existing) {
    console.log(`${email} already exists`);
    await sql.end();
    return;
  }

  const [broker] = await sql<{ id: string }[]>`
    insert into brokers (name, legal_name, ein, commission_rate_bps, kyb_status)
    values (${name}, ${legalName}, ${ein}, ${Number(rateBps)}, 'unverified')
    returning id
  `;

  await sql`
    insert into users (email, name, role, password_hash, broker_id)
    values (${email}, ${name}, 'broker', ${await hash(password, 10)}, ${broker.id}::uuid)
  `;

  console.log(`${name} added as ${broker.id}, unverified, ${Number(rateBps) / 100}% commission`);
  console.log(`login ${email} / ${password}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
