import postgres from 'postgres';
import { hash } from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const [legalName, email] = process.argv.slice(2);
if (!legalName || !email) {
  console.error('usage: add-customer-login <customer legal name> <login email> [password]');
  process.exit(1);
}

const password = process.argv[4] ?? 'corgi-demo-2026';
const sql = postgres(url, { max: 1, prepare: false });

async function main() {
  const [customer] = await sql<{ id: string; name: string }[]>`
    select id, name from customers where lower(legal_name) = lower(${legalName})
  `;
  if (!customer) {
    console.error(`no customer called ${legalName}`);
    await sql.end();
    process.exit(1);
  }

  const [existing] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (existing) {
    console.log(`${email} already exists`);
    await sql.end();
    return;
  }

  await sql`
    insert into users (email, name, role, password_hash, customer_id)
    values (${email}, ${customer.name}, 'customer', ${await hash(password, 10)}, ${customer.id}::uuid)
  `;

  console.log(`${email} added as a read-only login for ${customer.name}`);
  console.log(`login ${email} / ${password}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
