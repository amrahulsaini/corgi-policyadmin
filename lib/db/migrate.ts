import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from 'postgres';

export async function runMigrations(sql: Sql, dir = join(process.cwd(), 'db', 'migrations')) {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    ran.push(file);
  }
  return ran;
}

export async function resetSchema(sql: Sql) {
  await sql.unsafe('drop schema public cascade; create schema public;');
}
