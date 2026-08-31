import postgres from 'postgres';
import { minor } from '../lib/money';
import { issuePolicy } from '../lib/policy/issue';
import { createPremiumCheckout } from '../lib/payments/collect';
import { surchargesFor } from '../lib/tax';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const probe = postgres(url, { max: 1, prepare: false });

async function main() {
  const [broker] = await probe<{ id: string }[]>`
    select id from brokers where kyb_status = 'approved' limit 1
  `;
  const [customer] = await probe<{ id: string; state_code: string }[]>`
    select id, state_code from customers order by legal_name limit 1
  `;
  if (!broker || !customer) throw new Error('seed the database first');

  const termStart = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const issued = await issuePolicy({
    brokerId: broker.id,
    customerId: customer.id,
    productCode: 'CGL',
    stateCode: customer.state_code,
    termStart,
    limitMinor: minor('1000000.00'),
    deductibleMinor: minor('2500.00'),
    exposures: [
      { kind: 'vehicle', description: 'Unit 1', vin: 'TESTVIN0000000001', garageState: customer.state_code },
      { kind: 'vehicle', description: 'Unit 2', vin: 'TESTVIN0000000002', garageState: customer.state_code },
      { kind: 'vehicle', description: 'Unit 3', vin: 'TESTVIN0000000003', garageState: customer.state_code },
      { kind: 'location', description: 'Primary premises', squareFeet: 12000, state: customer.state_code },
    ],
    actor: 'scripts/demo-bind',
  });

  const surcharges = await surchargesFor(customer.state_code, issued.annualPremiumMinor, termStart);

  const checkout = await createPremiumCheckout({
    policyId: issued.policyId,
    versionId: issued.versionId,
    reason: 'issuance',
    premiumMinor: issued.annualPremiumMinor,
    surcharges,
    effectiveDate: termStart,
    actor: 'scripts/demo-bind',
  });

  console.log(
    JSON.stringify(
      {
        policyNumber: issued.policyNumber,
        policyId: issued.policyId,
        termStart,
        termEnd: issued.termEnd,
        premiumMinor: issued.annualPremiumMinor.toString(),
        surchargeMinor: issued.surchargeTotalMinor.toString(),
        totalMinor: checkout.totalMinor.toString(),
        chargeId: checkout.chargeId,
        checkoutUrl: checkout.checkoutUrl,
      },
      null,
      2,
    ),
  );

  await probe.end();
}

main().catch(async (err) => {
  console.error(err);
  await probe.end();
  process.exit(1);
});
