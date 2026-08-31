import { sql } from '@/lib/db';

export class ProviderUnavailable extends Error {
  constructor(provider: string) {
    super(
      `${provider} is unreachable. Nothing was charged and nothing was booked — the ledger is exactly where it was.`,
    );
    this.name = 'ProviderUnavailable';
  }
}

export async function flagEnabled(name: string): Promise<boolean> {
  const [row] = await sql<{ enabled: boolean }[]>`
    select enabled from ops_flags where name = ${name}
  `;
  return row?.enabled ?? false;
}

export async function setFlag(name: string, enabled: boolean, actor: string): Promise<void> {
  await sql`
    update ops_flags set enabled = ${enabled}, changed_at = now(), changed_by = ${actor}
     where name = ${name}
  `;
}

export async function listFlags(): Promise<
  { name: string; enabled: boolean; note: string | null; changedAt: string; changedBy: string | null }[]
> {
  const rows = await sql<
    { name: string; enabled: boolean; note: string | null; changed_at: string; changed_by: string | null }[]
  >`select name, enabled, note, changed_at::text, changed_by from ops_flags order by name`;
  return rows.map((r) => ({
    name: r.name,
    enabled: r.enabled,
    note: r.note,
    changedAt: r.changed_at,
    changedBy: r.changed_by,
  }));
}

export async function assertStripeUp(): Promise<void> {
  if (await flagEnabled('stripe_outage')) throw new ProviderUnavailable('Stripe');
}
