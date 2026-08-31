import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import type { Minor } from '@/lib/money';
import type { IsoDate } from '@/lib/premium';

export type StatementLine = {
  policyNumber: string;
  effectiveDate: IsoDate;
  eventType: string;
  memo: string;
  premiumCollectedMinor: Minor;
  commissionMinor: Minor;
};

export type BrokerStatement = {
  brokerId: string;
  brokerName: string;
  commissionRateBps: number;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  closedAt: Date;
  lines: StatementLine[];
  premiumCollectedMinor: Minor;
  commissionEarnedMinor: Minor;
  commissionClawedBackMinor: Minor;
  netDueMinor: Minor;
  ledgerCommissionMinor: Minor;
  tiesOut: boolean;
  fingerprint: string;
};

export function monthBounds(month: string): { start: IsoDate; end: IsoDate } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`not a month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = `${m[1]}-${m[2]}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const end = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;
  return { start, end };
}

export async function brokerStatement(
  brokerId: string,
  month: string,
  knownAt?: Date,
): Promise<BrokerStatement> {
  const { start, end } = monthBounds(month);

  const [broker] = await sql<{ name: string; commission_rate_bps: number }[]>`
    select name, commission_rate_bps from brokers where id = ${brokerId}::uuid
  `;
  if (!broker) throw new Error('broker not found');

  const closedAt = knownAt ?? new Date();

  const rows = await sql<
    {
      policy_number: string | null;
      effective_date: string;
      event_type: string;
      memo: string;
      premium_collected: bigint;
      commission: bigint;
    }[]
  >`
    select p.policy_number, e.effective_date::text, e.event_type, e.memo,
           coalesce(sum(case when l.account_code = '1000'
                             then (case when l.side = 'debit' then l.amount_minor else -l.amount_minor end)
                             else 0 end), 0) as premium_collected,
           coalesce(sum(case when l.account_code = '2200'
                             then (case when l.side = 'credit' then l.amount_minor else -l.amount_minor end)
                             else 0 end), 0) as commission
      from journal_entries e
      join journal_lines l on l.entry_id = e.id
      left join policies p on p.id = e.policy_id
     where e.broker_id = ${brokerId}::uuid
       and e.effective_date >= ${start}::date
       and e.effective_date < ${end}::date
       and e.booked_at <= ${closedAt}
     group by e.id, p.policy_number, e.effective_date, e.event_type, e.memo, e.seq
     having coalesce(sum(case when l.account_code in ('1000','2200') then l.amount_minor else 0 end), 0) <> 0
     order by e.seq
  `;

  const lines: StatementLine[] = rows.map((r) => ({
    policyNumber: r.policy_number ?? '—',
    effectiveDate: r.effective_date,
    eventType: r.event_type,
    memo: r.memo,
    premiumCollectedMinor: BigInt(r.premium_collected),
    commissionMinor: BigInt(r.commission),
  }));

  const premiumCollected = lines.reduce((t, l) => t + l.premiumCollectedMinor, 0n);
  const commissionEarned = lines
    .filter((l) => l.commissionMinor > 0n)
    .reduce((t, l) => t + l.commissionMinor, 0n);
  const clawedBack = lines
    .filter((l) => l.commissionMinor < 0n)
    .reduce((t, l) => t - l.commissionMinor, 0n);

  const [tie] = await sql<{ v: bigint }[]>`
    select coalesce(sum(case when l.side = 'credit' then l.amount_minor else -l.amount_minor end), 0) as v
      from journal_lines l
      join journal_entries e on e.id = l.entry_id
     where l.account_code = '2200'
       and e.broker_id = ${brokerId}::uuid
       and e.effective_date >= ${start}::date
       and e.effective_date < ${end}::date
       and e.booked_at <= ${closedAt}
  `;

  const netDue = commissionEarned - clawedBack;
  const ledgerCommission = BigInt(tie.v);

  const fingerprint = createHash('sha256')
    .update(
      [
        brokerId,
        month,
        premiumCollected.toString(),
        commissionEarned.toString(),
        clawedBack.toString(),
        netDue.toString(),
        ...lines.map((l) => `${l.policyNumber}:${l.effectiveDate}:${l.commissionMinor}`),
      ].join('|'),
    )
    .digest('hex');

  return {
    brokerId,
    brokerName: broker.name,
    commissionRateBps: broker.commission_rate_bps,
    periodStart: start,
    periodEnd: end,
    closedAt,
    lines,
    premiumCollectedMinor: premiumCollected,
    commissionEarnedMinor: commissionEarned,
    commissionClawedBackMinor: clawedBack,
    netDueMinor: netDue,
    ledgerCommissionMinor: ledgerCommission,
    tiesOut: netDue === ledgerCommission,
    fingerprint,
  };
}
