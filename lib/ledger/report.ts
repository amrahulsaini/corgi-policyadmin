import type { Db } from '@/lib/db/types';
import { sql as defaultSql } from '@/lib/db';
import type { IsoDate } from '@/lib/premium';
import type { Minor } from '@/lib/money';

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal: 'debit' | 'credit';
  debitMinor: Minor;
  creditMinor: Minor;
  balanceMinor: Minor;
};

export async function trialBalance(
  opts: { asOf?: IsoDate; knownAt?: Date } = {},
  tx: Db = defaultSql,
): Promise<TrialBalanceRow[]> {
  const rows = await tx<
    {
      code: string;
      name: string;
      type: TrialBalanceRow['type'];
      normal: 'debit' | 'credit';
      debit: bigint;
      credit: bigint;
    }[]
  >`
    select a.code, a.name, a.type, a.normal,
           coalesce(sum(case when l.side = 'debit'  then l.amount_minor else 0 end), 0) as debit,
           coalesce(sum(case when l.side = 'credit' then l.amount_minor else 0 end), 0) as credit
      from ledger_accounts a
      left join journal_lines l on l.account_code = a.code
      left join journal_entries e on e.id = l.entry_id
       and (${opts.asOf ?? null}::date is null or e.effective_date <= ${opts.asOf ?? null}::date)
       and (${opts.knownAt ?? null}::timestamptz is null or e.booked_at <= ${opts.knownAt ?? null}::timestamptz)
     where l.id is null or e.id is not null
     group by a.code, a.name, a.type, a.normal
     order by a.code
  `;

  return rows.map((r) => {
    const debit = BigInt(r.debit);
    const credit = BigInt(r.credit);
    return {
      code: r.code,
      name: r.name,
      type: r.type,
      normal: r.normal,
      debitMinor: debit,
      creditMinor: credit,
      balanceMinor: r.normal === 'debit' ? debit - credit : credit - debit,
    };
  });
}

export type ChainStatus = {
  entries: number;
  intact: boolean;
  firstBreakSeq: number | null;
  reason: string | null;
};

export async function chainStatus(tx: Db = defaultSql): Promise<ChainStatus> {
  const rows = await tx<{ seq: bigint; ok: boolean; reason: string | null }[]>`
    select seq, ok, reason from ledger_verify_chain()
  `;
  const bad = rows.find((r) => !r.ok);
  return {
    entries: rows.length,
    intact: !bad,
    firstBreakSeq: bad ? Number(bad.seq) : null,
    reason: bad?.reason ?? null,
  };
}
