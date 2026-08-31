import type { Db } from '@/lib/db/types';
import { sql as defaultSql } from '@/lib/db';
import type { AccountCode } from './accounts';
import type { IsoDate } from '@/lib/premium';
import type { Minor } from '@/lib/money';

export type Posting = {
  accountCode: AccountCode;
  side: 'debit' | 'credit';
  amountMinor: Minor;
  policyId?: string;
  brokerId?: string;
  claimId?: string;
};

export type EntryInput = {
  effectiveDate: IsoDate;
  eventType: string;
  memo: string;
  source: 'stripe' | 'persona' | 'plaid' | 'staff' | 'system' | 'agent';
  postingKey: string;
  lines: Posting[];
  sourceRef?: string;
  reversesEntryId?: string;
  correctsEntryId?: string;
  policyId?: string;
  brokerId?: string;
  claimId?: string;
  actor?: string;
  bookedAt?: Date;
};

export function debit(
  accountCode: AccountCode,
  amountMinor: Minor,
  dims: Omit<Posting, 'accountCode' | 'side' | 'amountMinor'> = {},
): Posting {
  return { accountCode, side: 'debit', amountMinor, ...dims };
}

export function credit(
  accountCode: AccountCode,
  amountMinor: Minor,
  dims: Omit<Posting, 'accountCode' | 'side' | 'amountMinor'> = {},
): Posting {
  return { accountCode, side: 'credit', amountMinor, ...dims };
}

export async function post(entry: EntryInput, tx: Db = defaultSql): Promise<string> {
  const lines = entry.lines
    .filter((l) => l.amountMinor !== 0n)
    .map((l) => ({
      account_code: l.accountCode,
      side: l.side,
      amount_minor: l.amountMinor.toString(),
      policy_id: l.policyId ?? null,
      broker_id: l.brokerId ?? null,
      claim_id: l.claimId ?? null,
    }));

  const [row] = await tx<{ ledger_post: string }[]>`
    select ledger_post(
      ${entry.effectiveDate}::date,
      ${entry.eventType},
      ${entry.memo},
      ${entry.source},
      ${entry.postingKey},
      ${defaultSql.json(lines)}::jsonb,
      ${entry.sourceRef ?? null},
      ${entry.reversesEntryId ?? null}::uuid,
      ${entry.correctsEntryId ?? null}::uuid,
      ${entry.policyId ?? null}::uuid,
      ${entry.brokerId ?? null}::uuid,
      ${entry.claimId ?? null}::uuid,
      ${entry.actor ?? null},
      ${entry.bookedAt ?? null}::timestamptz
    )
  `;
  return row.ledger_post;
}

export async function reverse(
  entryId: string,
  opts: { effectiveDate?: IsoDate; memo: string; actor?: string; postingKey: string },
  tx: Db = defaultSql,
): Promise<string> {
  const [original] = await tx<
    {
      id: string;
      effective_date: string;
      event_type: string;
      policy_id: string | null;
      broker_id: string | null;
      claim_id: string | null;
    }[]
  >`select id, effective_date::text, event_type, policy_id, broker_id, claim_id
      from journal_entries where id = ${entryId}::uuid`;
  if (!original) throw new Error(`no entry ${entryId}`);

  const lines = await tx<
    {
      account_code: AccountCode;
      side: 'debit' | 'credit';
      amount_minor: bigint;
      policy_id: string | null;
      broker_id: string | null;
      claim_id: string | null;
    }[]
  >`select account_code, side, amount_minor, policy_id, broker_id, claim_id
      from journal_lines where entry_id = ${entryId}::uuid order by line_no`;

  return post(
    {
      effectiveDate: opts.effectiveDate ?? original.effective_date,
      eventType: `${original.event_type}.reversed`,
      memo: opts.memo,
      source: 'staff',
      postingKey: opts.postingKey,
      reversesEntryId: entryId,
      policyId: original.policy_id ?? undefined,
      brokerId: original.broker_id ?? undefined,
      claimId: original.claim_id ?? undefined,
      actor: opts.actor,
      lines: lines.map((l) => ({
        accountCode: l.account_code,
        side: l.side === 'debit' ? ('credit' as const) : ('debit' as const),
        amountMinor: BigInt(l.amount_minor),
        policyId: l.policy_id ?? undefined,
        brokerId: l.broker_id ?? undefined,
        claimId: l.claim_id ?? undefined,
      })),
    },
    tx,
  );
}

export async function balance(
  accountCode: AccountCode,
  opts: { asOf?: IsoDate; knownAt?: Date } = {},
  tx: Db = defaultSql,
): Promise<Minor> {
  const [row] = await tx<{ ledger_balance: bigint }[]>`
    select ledger_balance(${accountCode}, ${opts.asOf ?? null}::date, ${opts.knownAt ?? null}::timestamptz)
  `;
  return BigInt(row.ledger_balance);
}
