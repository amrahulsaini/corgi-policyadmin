'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { format, minor } from '@/lib/money';
import { issuePolicy } from '@/lib/policy/issue';
import { createPremiumCheckout } from '@/lib/payments/collect';
import { surchargesFor } from '@/lib/tax';
import { rate, type Exposure } from '@/lib/rating';
import { anniversary } from '@/lib/premium';
import { FILED_STATES } from './filed-states';

export type QuoteState = { error: string | null };

export async function bindAndCollect(
  _prev: QuoteState,
  form: FormData,
): Promise<QuoteState> {
  const user = await requireRole('broker');
  if (!user.brokerId) return { error: 'This login is not attached to an agency.' };

  const customerId = String(form.get('customerId') ?? '');
  const termStart = String(form.get('termStart') ?? '');
  const limit = String(form.get('limit') ?? '');
  const deductible = String(form.get('deductible') ?? '');
  const vehicles = Number(form.get('vehicles') ?? 0);
  const squareFeet = Number(form.get('squareFeet') ?? 0);

  if (!customerId) return { error: 'Choose an insured, or add a new one.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termStart)) return { error: 'Give a valid inception date.' };
  if (!Number.isInteger(vehicles) || vehicles < 0 || vehicles > 50) {
    return { error: 'Scheduled vehicles must be a whole number between 0 and 50.' };
  }
  if (!Number.isInteger(squareFeet) || squareFeet < 0 || squareFeet > 500_000) {
    return { error: 'Scheduled floor area must be between 0 and 500,000 square feet.' };
  }

  let resolvedCustomerId = customerId;

  if (customerId === 'new') {
    const legalName = String(form.get('newLegalName') ?? '').trim();
    const email = String(form.get('newEmail') ?? '').trim();
    const stateCode = String(form.get('newState') ?? '').trim().toUpperCase();

    if (legalName.length < 2) return { error: 'Give the legal name of the insured.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: 'Give a contact email for the insured.' };
    }
    if (!FILED_STATES.includes(stateCode)) {
      return {
        error: `No rates are filed for ${stateCode || 'that state'}. This product is filed in ${FILED_STATES.join(', ')}.`,
      };
    }

    const [existing] = await sql<{ id: string }[]>`
      select id from customers where lower(legal_name) = lower(${legalName})
    `;
    if (existing) {
      resolvedCustomerId = existing.id;
    } else {
      const shortName = legalName.replace(/\s+\b(llc|inc|co|corp|ltd|limited|company)\b\.?$/i, '').trim();
      const [created] = await sql<{ id: string }[]>`
        insert into customers (name, legal_name, email, state_code)
        values (${shortName || legalName}, ${legalName}, ${email}, ${stateCode})
        returning id
      `;
      resolvedCustomerId = created.id;
    }
  }

  const [customer] = await sql<{ state_code: string; legal_name: string }[]>`
    select state_code, legal_name from customers where id = ${resolvedCustomerId}::uuid
  `;
  if (!customer) return { error: 'That insured is not on file.' };

  const exposures: Exposure[] = [];
  for (let i = 0; i < vehicles; i += 1) {
    exposures.push({
      kind: 'vehicle',
      description: `Scheduled unit ${i + 1}`,
      vin: `TESTVIN${String(i + 1).padStart(10, '0')}`,
      garageState: customer.state_code,
    });
  }
  if (squareFeet > 0) {
    exposures.push({
      kind: 'location',
      description: 'Primary premises',
      squareFeet,
      state: customer.state_code,
    });
  }

  let checkoutUrl: string;

  try {
    const issued = await issuePolicy({
      brokerId: user.brokerId,
      customerId: resolvedCustomerId,
      productCode: 'CGL',
      stateCode: customer.state_code,
      termStart,
      limitMinor: minor(limit),
      deductibleMinor: minor(deductible),
      exposures,
      actor: user.email,
    });

    const surcharges = await surchargesFor(
      customer.state_code,
      issued.annualPremiumMinor,
      termStart,
    );

    const checkout = await createPremiumCheckout({
      policyId: issued.policyId,
      versionId: issued.versionId,
      reason: 'issuance',
      premiumMinor: issued.annualPremiumMinor,
      surcharges,
      effectiveDate: termStart,
      actor: user.email,
    });

    checkoutUrl = checkout.checkoutUrl;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not bind this risk.' };
  }

  redirect(checkoutUrl);
}

export type QuoteLine = { label: string; amount: string; basis: string };

export type BindQuote = {
  error: string | null;
  components: QuoteLine[];
  annualPremium: string;
  surcharges: QuoteLine[];
  surchargeTotal: string;
  total: string;
  stateCode: string;
  termStart: string;
  termEnd: string;
};

export async function quoteRisk(input: {
  customerId: string;
  newState: string;
  termStart: string;
  limit: string;
  deductible: string;
  vehicles: number;
  squareFeet: number;
}): Promise<BindQuote | null> {
  await requireRole('broker');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.termStart)) return null;
  if (!Number.isInteger(input.vehicles) || input.vehicles < 0 || input.vehicles > 50) return null;
  if (!Number.isInteger(input.squareFeet) || input.squareFeet < 0 || input.squareFeet > 500_000) {
    return null;
  }

  let stateCode = input.newState.trim().toUpperCase();

  if (input.customerId !== 'new') {
    const [customer] = await sql<{ state_code: string }[]>`
      select state_code from customers where id = ${input.customerId}::uuid
    `;
    if (!customer) return null;
    stateCode = customer.state_code;
  }

  const blank = {
    components: [],
    annualPremium: '',
    surcharges: [],
    surchargeTotal: '',
    total: '',
    stateCode,
    termStart: input.termStart,
    termEnd: '',
  };

  if (!stateCode) {
    return { error: 'Pick the state the insured sits in.', ...blank };
  }

  const exposures: Exposure[] = [];
  for (let i = 0; i < input.vehicles; i += 1) {
    exposures.push({
      kind: 'vehicle',
      description: `Scheduled unit ${i + 1}`,
      vin: `TESTVIN${String(i + 1).padStart(10, '0')}`,
      garageState: stateCode,
    });
  }
  if (input.squareFeet > 0) {
    exposures.push({
      kind: 'location',
      description: 'Primary premises',
      squareFeet: input.squareFeet,
      state: stateCode,
    });
  }

  try {
    const rated = rate({
      productCode: 'CGL',
      stateCode,
      limitMinor: minor(input.limit),
      deductibleMinor: minor(input.deductible),
      exposures,
    });

    const surcharges = await surchargesFor(stateCode, rated.annualPremiumMinor, input.termStart);
    const surchargeTotal = surcharges.reduce((t, s) => t + s.amountMinor, 0n);

    return {
      error: null,
      components: rated.components.map((c) => ({
        label: c.label,
        amount: format(c.amountMinor),
        basis: c.basis,
      })),
      annualPremium: format(rated.annualPremiumMinor),
      surcharges: surcharges.map((s) => ({
        label: `${stateCode} ${s.label}`,
        amount: format(s.amountMinor),
        basis: s.basis,
      })),
      surchargeTotal: format(surchargeTotal),
      total: format(rated.annualPremiumMinor + surchargeTotal),
      stateCode,
      termStart: input.termStart,
      termEnd: anniversary(input.termStart),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'This risk cannot be rated.',
      ...blank,
    };
  }
}
