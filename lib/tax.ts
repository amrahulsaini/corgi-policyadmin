import type { Db } from '@/lib/db/types';
import { sql as defaultSql } from '@/lib/db';
import { rateOf, type Minor } from './money';
import { ACCOUNT, type AccountCode } from './ledger/accounts';
import type { IsoDate } from './premium';

export type Surcharge = {
  kind: string;
  label: string;
  amountMinor: Minor;
  refundable: boolean;
  accountCode: AccountCode;
  basis: string;
};

const ACCOUNT_FOR: Record<string, AccountCode> = {
  surplus_lines_tax: ACCOUNT.surplusLinesTax,
  stamping_fee: ACCOUNT.stampingFee,
  policy_fee: ACCOUNT.policyFeeIncome,
};

type RateRow = {
  kind: string;
  rate_bps: number | null;
  flat_minor: bigint | null;
  refundable: boolean;
  authority: string;
};

export async function ratesFor(
  stateCode: string,
  onDate: IsoDate,
  tx: Db = defaultSql,
): Promise<RateRow[]> {
  return tx<RateRow[]>`
    select kind, rate_bps, flat_minor, refundable, authority
      from tax_rates
     where state_code = ${stateCode}
       and effective_from <= ${onDate}::date
       and (effective_to is null or effective_to > ${onDate}::date)
     order by kind
  `;
}

export async function surchargesFor(
  stateCode: string,
  premiumMinor: Minor,
  onDate: IsoDate,
  tx: Db = defaultSql,
): Promise<Surcharge[]> {
  const rows = await ratesFor(stateCode, onDate, tx);
  if (rows.length === 0) throw new Error(`no filed taxes or fees for ${stateCode} on ${onDate}`);

  const flats = rows.filter((r) => r.flat_minor !== null);
  const percents = rows.filter((r) => r.rate_bps !== null);

  const surcharges: Surcharge[] = flats.map((r) => ({
    kind: r.kind,
    label: labelFor(r.kind),
    amountMinor: BigInt(r.flat_minor as bigint),
    refundable: r.refundable,
    accountCode: accountFor(r.kind),
    basis: r.authority,
  }));

  const taxableBase = premiumMinor + surcharges.reduce((total, s) => total + s.amountMinor, 0n);

  for (const r of percents) {
    surcharges.push({
      kind: r.kind,
      label: labelFor(r.kind),
      amountMinor: rateOf(taxableBase, r.rate_bps as number),
      refundable: r.refundable,
      accountCode: accountFor(r.kind),
      basis: r.authority,
    });
  }

  return surcharges;
}

export function refundableOf(surcharges: Surcharge[]): Surcharge[] {
  return surcharges.filter((s) => s.refundable);
}

export function totalOf(surcharges: Surcharge[]): Minor {
  return surcharges.reduce((total, s) => total + s.amountMinor, 0n);
}

function accountFor(kind: string): AccountCode {
  const code = ACCOUNT_FOR[kind];
  if (!code) throw new Error(`no ledger account mapped for surcharge ${kind}`);
  return code;
}

function labelFor(kind: string): string {
  if (kind === 'surplus_lines_tax') return 'Surplus lines tax';
  if (kind === 'stamping_fee') return 'Stamping fee';
  if (kind === 'policy_fee') return 'Policy fee';
  return kind;
}
