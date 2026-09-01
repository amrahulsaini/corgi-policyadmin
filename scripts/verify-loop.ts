import postgres from 'postgres';
import { format, minor } from '../lib/money';
import { stripe } from '../lib/stripe';
import { applyEndorsement } from '../lib/policy/endorse';
import { correctEndorsementDate } from '../lib/policy/correct';
import { cancelPolicy, quoteCancellation } from '../lib/policy/cancel';
import { openClaim, adjustReserve, payClaim, claimPosition } from '../lib/claims';
import { verifyPayee } from '../lib/bank/verify';
import { brokerStatement } from '../lib/statements';
import { runReconciliation, listBreaks } from '../lib/reconciliation';
import { applyPaymentSucceeded } from '../lib/payments/apply';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const probe = postgres(url, { max: 1, prepare: false });

function head(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

async function trial() {
  const [r] = await probe<{ d: bigint; c: bigint }[]>`
    select coalesce(sum(case when side='debit' then amount_minor else 0 end),0) as d,
           coalesce(sum(case when side='credit' then amount_minor else 0 end),0) as c
      from journal_lines
  `;
  const [chain] = await probe<{ ok: boolean }[]>`select bool_and(ok) as ok from ledger_verify_chain()`;
  return `debits ${format(BigInt(r.d))}  credits ${format(BigInt(r.c))}  ${BigInt(r.d) === BigInt(r.c) ? 'BALANCED' : 'OUT OF BALANCE'}  chain ${chain.ok ? 'intact' : 'BROKEN'}`;
}

async function main() {
  const [policy] = await probe<
    { id: string; policy_number: string; broker_id: string; term_start: string; term_end: string; insured: string }[]
  >`select p.id, p.policy_number, p.broker_id, p.term_start::text, p.term_end::text,
           c.legal_name as insured
      from policies p join customers c on c.id = p.customer_id
     where p.status = 'bound' order by p.created_at limit 1`;
  if (!policy) throw new Error('no bound policy — run demo-bind first');

  head(`1. COLLECT PREMIUM — ${policy.policy_number}`);
  const [charge] = await probe<{ id: string; total_minor: bigint }[]>`
    select id, total_minor from premium_charges where policy_id = ${policy.id}::uuid order by created_at limit 1
  `;
  const intent = await stripe.paymentIntents.create(
    {
      amount: Number(charge.total_minor),
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      metadata: { charge_id: charge.id, policy_number: policy.policy_number },
    },
    { idempotencyKey: `verify-loop:${charge.id}` },
  );
  console.log(`stripe intent ${intent.id} → ${intent.status}, ${format(BigInt(intent.amount_received ?? 0))}`);
  const applied = await applyPaymentSucceeded({
    chargeId: charge.id,
    intentId: intent.id,
    amountMinor: BigInt(charge.total_minor),
    occurredAt: new Date(),
    eventId: `verify_${Date.now()}`,
  });
  console.log(`consumer → ${applied.status}: ${applied.note}`);
  console.log(await trial());

  head('2. ENDORSE AT A WRONG DATE, THEN CORRECT IT');
  const endorsed = await applyEndorsement({
    settleNow: false,
    policyId: policy.id,
    effectiveDate: '2026-12-01',
    limitMinor: minor('2000000.00'),
    deductibleMinor: minor('2500.00'),
    exposures: [
      { kind: 'vehicle', description: 'Unit 1', vin: 'TESTVIN0000000001', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 2', vin: 'TESTVIN0000000002', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 3', vin: 'TESTVIN0000000003', garageState: 'CA' },
      { kind: 'vehicle', description: 'Unit 4', vin: 'TESTVIN0000000004', garageState: 'CA' },
      { kind: 'location', description: 'Primary premises', squareFeet: 12000, state: 'CA' },
    ],
    description: 'Add unit 4 and raise the occurrence limit to 2M',
    actor: 'scripts/verify-loop',
  });
  console.log(`booked at 2026-12-01: pro-rata ${format(endorsed.pricing.proRataPremiumMinor)} over ${endorsed.pricing.daysRemaining}/${endorsed.pricing.termDays} days, tax ${format(endorsed.pricing.surchargeTotalMinor)}`);

  const corrected = await correctEndorsementDate({
    versionId: endorsed.versionId,
    correctedEffectiveDate: '2026-10-01',
    reason: 'Effective date keyed in error at entry',
    actor: 'scripts/verify-loop',
  });
  console.log(`corrected to 2026-10-01: was ${format(corrected.preview.originalProRataMinor)}, now ${format(corrected.preview.correctedProRataMinor)}, difference ${format(corrected.preview.differenceMinor)}`);
  const [orig] = await probe<{ effective_date: string }[]>`
    select effective_date::text from journal_entries where id = ${endorsed.entryId}::uuid
  `;
  console.log(`original entry still effective ${orig.effective_date} — untouched`);
  console.log(await trial());

  head('3. OPEN A CLAIM, VERIFY THE PAYEE, RESERVE AND PAY');
  const claim = await openClaim({
    policyId: policy.id,
    lossDate: '2026-11-15',
    reportedDate: '2026-11-20',
    description: 'Third-party bodily injury at insured premises',
    reserveMinor: minor('40000.00'),
    payeeName: policy.insured,
    actor: 'scripts/verify-loop',
  });
  const verification = await verifyPayee({ claimId: claim.claimId, payeeName: policy.insured });
  console.log(`${claim.claimNumber} opened, reserve ${format(minor('40000.00'))}`);
  console.log(`payee check via ${verification.provider}${verification.live ? ' (live)' : ' (simulated)'} → holder "${verification.accountHolder}", match ${verification.nameMatches}`);

  await adjustReserve({
    claimId: claim.claimId,
    deltaMinor: minor('15000.00'),
    effectiveDate: '2026-12-05',
    memo: 'Adjuster report revised the estimate upward',
    actor: 'scripts/verify-loop',
  });

  if (verification.nameMatches) {
    await payClaim({
      claimId: claim.claimId,
      amountMinor: minor('22000.00'),
      effectiveDate: '2026-12-10',
      memo: 'Partial indemnity payment',
      actor: 'scripts/verify-loop',
    });
  }

  const position = await claimPosition(claim.claimId);
  console.log(`limit ${format(position!.limitMinor)}  reserve ${format(position!.reserveMinor)}  paid ${format(position!.paidMinor)}  incurred ${format(position!.incurredMinor)}`);

  try {
    await payClaim({
      claimId: claim.claimId,
      amountMinor: minor('9000000.00'),
      effectiveDate: '2026-12-11',
      memo: 'Deliberate over-limit attempt',
      actor: 'scripts/verify-loop',
    });
    console.log('OVER-LIMIT PAYMENT WAS ALLOWED — this is a bug');
  } catch (err) {
    console.log(`over-limit payment refused: ${(err as Error).message}`);
  }

  const wrongPayee = await verifyPayee({ claimId: claim.claimId, payeeName: 'Totally Different Holdings Inc' });
  console.log(`re-checked against a third-party payee → holder "${wrongPayee.accountHolder}", match ${wrongPayee.nameMatches} (payouts now blocked)`);
  await verifyPayee({ claimId: claim.claimId, payeeName: policy.insured });
  console.log(await trial());

  head('4. CANCEL MID-TERM WITH AN OPEN CLAIM, REAL REFUND');
  const quote = await quoteCancellation({
    policyId: policy.id,
    effectiveDate: '2027-01-15',
    method: 'pro_rata',
    reason: 'Insured requested cancellation',
    actor: 'scripts/verify-loop',
  });
  console.log(`written ${format(quote.writtenMinor)}  earned ${format(quote.earnedMinor)}  unearned ${format(quote.unearnedMinor)}`);
  console.log(`tax returned ${format(quote.returnedTaxMinor)}  policy fee retained ${format(quote.retainedFeeMinor)}  refund ${format(quote.refundTotalMinor)}  clawback ${format(quote.commissionClawbackMinor)}`);

  const cancelled = await cancelPolicy({
    policyId: policy.id,
    effectiveDate: '2027-01-15',
    method: 'pro_rata',
    reason: 'Insured requested cancellation',
    actor: 'scripts/verify-loop',
  });
  console.log(cancelled.providerNote);
  const after = await claimPosition(claim.claimId);
  console.log(`claim after cancellation: status ${after!.status}, reserve ${format(after!.reserveMinor)} — a cancelled policy does not extinguish a loss that already happened`);
  console.log(await trial());

  head('5. BROKER STATEMENT');
  const month = new Date().toISOString().slice(0, 7);
  const statement = await brokerStatement(policy.broker_id, month);
  console.log(`${statement.brokerName} · ${statement.periodStart} to ${statement.periodEnd}`);
  console.log(`collected ${format(statement.premiumCollectedMinor)}  earned ${format(statement.commissionEarnedMinor)}  clawed back ${format(statement.commissionClawedBackMinor)}  net ${format(statement.netDueMinor)}`);
  console.log(`ledger commission ${format(statement.ledgerCommissionMinor)} → ${statement.tiesOut ? 'TIES TO THE CENT' : 'DOES NOT TIE'}`);
  const rerun = await brokerStatement(policy.broker_id, month, statement.closedAt);
  console.log(`re-run fingerprint identical: ${rerun.fingerprint === statement.fingerprint}`);

  head('6. RECONCILIATION');
  const recon = await runReconciliation({ periodStart: `${month}-01`, periodEnd: nextMonth(month) });
  console.log(`checked ${recon.checked} settled payments, ${recon.breaks} break(s)`);
  for (const b of await listBreaks()) {
    console.log(`  ${b.kind}: ${b.detail}`);
  }

  head('FINAL');
  console.log(await trial());
  await probe.end();
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

main().catch(async (err) => {
  console.error(err);
  await probe.end();
  process.exit(1);
});
