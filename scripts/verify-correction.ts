import postgres from 'postgres';
import { minor, format } from '../lib/money';
import { applyEndorsement } from '../lib/policy/endorse';
import { correctEndorsementDate } from '../lib/policy/correct';
import { loadEntries } from '../lib/policy/view';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const probe = postgres(url, { max: 1, prepare: false });

async function unearned(policyId: string, asOf: string) {
  const [row] = await probe<{ v: bigint }[]>`
    select coalesce(sum(amount_minor), 0) as v from premium_layers where policy_id = ${policyId}::uuid
  `;
  return BigInt(row.v);
}

async function main() {
  const [policy] = await probe<{ id: string; policy_number: string; term_start: string; term_end: string }[]>`
    select id, policy_number, term_start::text, term_end::text
      from policies where status = 'bound' order by created_at limit 1
  `;
  if (!policy) throw new Error('no bound policy — run demo-bind first');

  console.log(`policy ${policy.policy_number}  term ${policy.term_start} → ${policy.term_end}`);
  console.log(`written premium before endorsement: ${format(await unearned(policy.id, policy.term_start))}`);

  const wrongDate = '2026-11-01';
  const rightDate = '2026-09-15';

  const endorsed = await applyEndorsement({
    policyId: policy.id,
    effectiveDate: wrongDate,
    limitMinor: minor('1000000.00'),
    deductibleMinor: minor('2500.00'),
    exposures: [
      { kind: 'vehicle', description: 'Unit 1', vin: 'TESTVIN0000000001', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 2', vin: 'TESTVIN0000000002', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 3', vin: 'TESTVIN0000000003', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 4', vin: 'TESTVIN0000000004', garageState: 'CA' },
      { kind: 'location', description: 'Primary premises', squareFeet: 12000, state: 'CA' },
    ],
    description: 'Add scheduled vehicle 4',
    actor: 'scripts/verify-correction',
  });

  console.log(`\nendorsed at the WRONG date ${wrongDate}`);
  console.log(`  annual delta   ${format(endorsed.pricing.annualDeltaMinor)}`);
  console.log(`  pro-rata       ${format(endorsed.pricing.proRataPremiumMinor)} over ${endorsed.pricing.daysRemaining} of ${endorsed.pricing.termDays} days`);
  console.log(`  surcharges     ${format(endorsed.pricing.surchargeTotalMinor)}`);
  console.log(`  charged        ${format(endorsed.pricing.totalMinor)}`);
  console.log(`  written now    ${format(await unearned(policy.id, policy.term_start))}`);

  const corrected = await correctEndorsementDate({
    versionId: endorsed.versionId,
    correctedEffectiveDate: rightDate,
    reason: 'Effective date keyed in error at entry',
    actor: 'scripts/verify-correction',
  });

  console.log(`\ncorrected to ${rightDate}`);
  console.log(`  original pro-rata  ${format(corrected.preview.originalProRataMinor)}`);
  console.log(`  corrected pro-rata ${format(corrected.preview.correctedProRataMinor)}`);
  console.log(`  difference         ${format(corrected.preview.differenceMinor)}`);
  console.log(`  written now        ${format(await unearned(policy.id, policy.term_start))}`);

  const [original] = await probe<{ effective_date: string; hash: string }[]>`
    select effective_date::text, hash from journal_entries where id = ${endorsed.entryId}::uuid
  `;
  console.log(`\noriginal entry still reads effective ${original.effective_date}, hash ${original.hash.slice(0, 16)}…`);

  const entries = await loadEntries(policy.id);
  console.log('\njournal for this policy:');
  for (const e of entries) {
    const total = e.lines.filter((l) => l.side === 'debit').reduce((t, l) => t + l.amountMinor, 0n);
    console.log(`  #${e.seq}  ${e.effectiveDate}  ${e.eventType.padEnd(24)} ${format(total).padStart(12)}${e.reversesEntryId ? '  (reversal)' : ''}`);
  }

  const [chain] = await probe<{ ok: boolean }[]>`
    select bool_and(ok) as ok from ledger_verify_chain()
  `;
  const [bal] = await probe<{ d: bigint; c: bigint }[]>`
    select coalesce(sum(case when side='debit' then amount_minor else 0 end),0) as d,
           coalesce(sum(case when side='credit' then amount_minor else 0 end),0) as c
      from journal_lines
  `;
  console.log(`\nchain intact: ${chain.ok}`);
  console.log(`total debits ${format(BigInt(bal.d))}  credits ${format(BigInt(bal.c))}  ${BigInt(bal.d) === BigInt(bal.c) ? 'BALANCED' : 'OUT OF BALANCE'}`);

  await probe.end();
}

main().catch(async (err) => {
  console.error(err);
  await probe.end();
  process.exit(1);
});
