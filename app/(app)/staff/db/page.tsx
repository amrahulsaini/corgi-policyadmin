import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format } from '@/lib/money';

export const dynamic = 'force-dynamic';

const LIMIT = 200;

function cell(column: string, value: unknown): { text: string; mono: boolean } {
  if (value === null || value === undefined) return { text: '—', mono: false };
  if (typeof value === 'bigint') {
    return column.endsWith('_minor')
      ? { text: format(value), mono: true }
      : { text: value.toString(), mono: true };
  }
  if (value instanceof Date) return { text: value.toISOString(), mono: true };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false', mono: true };
  if (typeof value === 'object') return { text: JSON.stringify(value), mono: true };
  const text = String(value);
  return { text, mono: /^[0-9a-f-]{36}$/.test(text) || /^\d/.test(text) };
}

export default async function DbPage(props: { searchParams: Promise<{ table?: string }> }) {
  await requireRole('staff');
  const query = await props.searchParams;

  const tables = await sql<{ name: string }[]>`
    select table_name as name
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `;

  const names = tables.map((t) => t.name).filter((n) => /^[a-z_]+$/.test(n));

  const counts =
    names.length === 0
      ? []
      : await sql.unsafe<{ name: string; rows: bigint }[]>(
          names.map((n) => `select '${n}' as name, count(*) as rows from ${n}`).join(' union all '),
        );

  const countOf = new Map(counts.map((c) => [c.name, BigInt(c.rows)]));
  const selected = names.includes(query.table ?? '') ? (query.table as string) : null;

  const rows = selected
    ? await sql.unsafe<Record<string, unknown>[]>(`select * from ${selected} limit ${LIMIT}`)
    : [];

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const total = selected ? (countOf.get(selected) ?? 0n) : 0n;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Database</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Every table behind this system, read straight from Postgres. Read-only — the append-only
          triggers on the ledger tables are still the only door in.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => {
          const rowCount = countOf.get(n) ?? 0n;
          const active = n === selected;
          return (
            <Link
              key={n}
              href={`/staff/db?table=${n}`}
              className={`num inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] hover:bg-[var(--line-soft)]'
              }`}
            >
              {n}
              <span className={rowCount === 0n ? 'text-[var(--ink-faint)]' : 'text-[var(--ink-faint)]'}>
                {rowCount.toString()}
              </span>
            </Link>
          );
        })}
      </div>

      {!selected ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm text-[var(--ink-soft)]">Pick a table above.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            <span className="num">{selected}</span> is empty.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-[var(--ink-faint)]">
            {total > BigInt(LIMIT)
              ? `Showing the first ${LIMIT} of ${total} rows.`
              : `${total} row${total === 1n ? '' : 's'}.`}
          </div>
          <div className="card overflow-x-auto">
            <table className="sheet">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c.replace(/_/g, ' ')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => {
                      const v = cell(c, r[c]);
                      return (
                        <td key={c} className={v.mono ? 'num' : undefined}>
                          <span className="block max-w-[28rem] truncate" title={v.text}>
                            {v.text}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
