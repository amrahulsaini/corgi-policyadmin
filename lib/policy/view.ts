import { sql } from '@/lib/db';
import { earnedAsOf, unearnedAsOf, writtenTotal, type IsoDate, type Layer } from '@/lib/premium';
import type { Minor } from '@/lib/money';
import type { Exposure } from '@/lib/rating';

export type PolicyHeader = {
  id: string;
  policyNumber: string;
  status: string;
  productCode: string;
  stateCode: string;
  termStart: IsoDate;
  termEnd: IsoDate;
  brokerId: string;
  brokerName: string;
  commissionRateBps: number;
  customerName: string;
  customerEmail: string;
};

export type PolicyVersion = {
  id: string;
  versionNo: number;
  kind: string;
  effectiveDate: IsoDate;
  bookedAt: string;
  limitMinor: Minor;
  deductibleMinor: Minor;
  annualPremiumMinor: Minor;
  exposures: Exposure[];
  description: string;
  actor: string | null;
  reversesVersionId: string | null;
  correctsVersionId: string | null;
};

export type PolicyAsOf = {
  header: PolicyHeader;
  asOf: IsoDate;
  knownAt: Date | null;
  version: PolicyVersion | null;
  versions: PolicyVersion[];
  layers: Layer[];
  writtenMinor: Minor;
  earnedMinor: Minor;
  unearnedMinor: Minor;
};

export async function loadHeader(policyId: string): Promise<PolicyHeader | null> {
  const [row] = await sql<
    {
      id: string;
      policy_number: string;
      status: string;
      product_code: string;
      state_code: string;
      term_start: string;
      term_end: string;
      broker_id: string;
      broker_name: string;
      commission_rate_bps: number;
      customer_name: string;
      customer_email: string;
    }[]
  >`
    select p.id, p.policy_number, p.status, p.product_code, p.state_code,
           p.term_start::text, p.term_end::text,
           b.id as broker_id, b.name as broker_name, b.commission_rate_bps,
           c.legal_name as customer_name, c.email as customer_email
      from policies p
      join brokers b on b.id = p.broker_id
      join customers c on c.id = p.customer_id
     where p.id = ${policyId}::uuid
  `;
  if (!row) return null;
  return {
    id: row.id,
    policyNumber: row.policy_number,
    status: row.status,
    productCode: row.product_code,
    stateCode: row.state_code,
    termStart: row.term_start,
    termEnd: row.term_end,
    brokerId: row.broker_id,
    brokerName: row.broker_name,
    commissionRateBps: row.commission_rate_bps,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
  };
}

export async function loadPolicyAsOf(
  policyId: string,
  asOf: IsoDate,
  knownAt: Date | null = null,
): Promise<PolicyAsOf | null> {
  const header = await loadHeader(policyId);
  if (!header) return null;

  const versionRows = await sql<
    {
      id: string;
      version_no: number;
      kind: string;
      effective_date: string;
      booked_at: string;
      limit_minor: bigint;
      deductible_minor: bigint;
      annual_premium_minor: bigint;
      exposures: Exposure[];
      description: string;
      actor: string | null;
      reverses_version_id: string | null;
      corrects_version_id: string | null;
    }[]
  >`
    select id, version_no, kind, effective_date::text, booked_at::text,
           limit_minor, deductible_minor, annual_premium_minor, exposures,
           description, actor, reverses_version_id, corrects_version_id
      from policy_versions
     where policy_id = ${policyId}::uuid
       and effective_date <= ${asOf}::date
       and (${knownAt}::timestamptz is null or booked_at <= ${knownAt}::timestamptz)
     order by effective_date, booked_at, version_no
  `;

  const versions: PolicyVersion[] = versionRows.map((r) => ({
    id: r.id,
    versionNo: r.version_no,
    kind: r.kind,
    effectiveDate: r.effective_date,
    bookedAt: r.booked_at,
    limitMinor: BigInt(r.limit_minor),
    deductibleMinor: BigInt(r.deductible_minor),
    annualPremiumMinor: BigInt(r.annual_premium_minor),
    exposures: r.exposures ?? [],
    description: r.description,
    actor: r.actor,
    reversesVersionId: r.reverses_version_id,
    correctsVersionId: r.corrects_version_id,
  }));

  const reversed = new Set(versions.filter((v) => v.reversesVersionId).map((v) => v.reversesVersionId!));
  const standing = versions.filter((v) => !reversed.has(v.id) && !v.reversesVersionId);
  const current = standing.length ? standing[standing.length - 1] : null;

  const layerRows = await sql<
    { id: string; starts_on: string; ends_on: string; amount_minor: bigint; reverses_layer_id: string | null }[]
  >`
    select id, starts_on::text, ends_on::text, amount_minor, reverses_layer_id
      from premium_layers
     where policy_id = ${policyId}::uuid
       and starts_on <= ${asOf}::date
       and (${knownAt}::timestamptz is null or booked_at <= ${knownAt}::timestamptz)
     order by starts_on, booked_at
  `;

  const layers: Layer[] = layerRows.map((r) => ({
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    amountMinor: BigInt(r.amount_minor),
  }));

  return {
    header,
    asOf,
    knownAt,
    version: current,
    versions,
    layers,
    writtenMinor: writtenTotal(layers),
    earnedMinor: earnedAsOf(layers, asOf),
    unearnedMinor: unearnedAsOf(layers, asOf),
  };
}

export type PolicyEntry = {
  id: string;
  seq: number;
  effectiveDate: IsoDate;
  bookedAt: string;
  eventType: string;
  memo: string;
  source: string;
  sourceRef: string | null;
  reversesEntryId: string | null;
  lines: { accountCode: string; accountName: string; side: string; amountMinor: Minor }[];
};

export async function loadEntries(policyId: string): Promise<PolicyEntry[]> {
  const rows = await sql<
    {
      id: string;
      seq: bigint;
      effective_date: string;
      booked_at: string;
      event_type: string;
      memo: string;
      source: string;
      source_ref: string | null;
      reverses_entry_id: string | null;
      lines: { account_code: string; account_name: string; side: string; amount_minor: string }[];
    }[]
  >`
    select e.id, e.seq, e.effective_date::text, e.booked_at::text, e.event_type, e.memo,
           e.source, e.source_ref, e.reverses_entry_id,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'account_code', l.account_code,
               'account_name', a.name,
               'side', l.side,
               'amount_minor', l.amount_minor::text
             ) order by l.line_no
           ) filter (where l.id is not null), '[]'::jsonb) as lines
      from journal_entries e
      left join journal_lines l on l.entry_id = e.id
      left join ledger_accounts a on a.code = l.account_code
     where e.policy_id = ${policyId}::uuid
     group by e.id, e.seq, e.effective_date, e.booked_at, e.event_type, e.memo,
              e.source, e.source_ref, e.reverses_entry_id
     order by e.seq
  `;

  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    effectiveDate: r.effective_date,
    bookedAt: r.booked_at,
    eventType: r.event_type,
    memo: r.memo,
    source: r.source,
    sourceRef: r.source_ref,
    reversesEntryId: r.reverses_entry_id,
    lines: r.lines.map((l) => ({
      accountCode: l.account_code,
      accountName: l.account_name,
      side: l.side,
      amountMinor: BigInt(l.amount_minor),
    })),
  }));
}
