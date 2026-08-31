'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import { minor } from '@/lib/money';
import { issuePolicy } from '@/lib/policy/issue';
import { createPremiumCheckout } from '@/lib/payments/collect';
import { surchargesFor } from '@/lib/tax';
import type { Exposure } from '@/lib/rating';

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

  if (!customerId) return { error: 'Choose an insured.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(termStart)) return { error: 'Give a valid inception date.' };
  if (!Number.isInteger(vehicles) || vehicles < 0 || vehicles > 50) {
    return { error: 'Scheduled vehicles must be a whole number between 0 and 50.' };
  }
  if (!Number.isInteger(squareFeet) || squareFeet < 0 || squareFeet > 500_000) {
    return { error: 'Scheduled floor area must be between 0 and 500,000 square feet.' };
  }

  const [customer] = await sql<{ state_code: string; legal_name: string }[]>`
    select state_code, legal_name from customers where id = ${customerId}::uuid
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
      customerId,
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
