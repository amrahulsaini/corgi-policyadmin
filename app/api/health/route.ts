import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ledger_accounts`;
    checks.database = `ok, ${row.n} accounts`;
  } catch (err) {
    healthy = false;
    checks.database = err instanceof Error ? err.message : 'unreachable';
  }

  return Response.json(
    { status: healthy ? 'ok' : 'degraded', checks, at: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
