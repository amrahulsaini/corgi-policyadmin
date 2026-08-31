import { sql } from '@/lib/db';
import { stripe } from '@/lib/stripe';
import type { Minor } from '@/lib/money';
import type { IsoDate } from '@/lib/premium';
import type { Surcharge } from '@/lib/tax';
import { assertStripeUp } from '@/lib/ops';

export type CollectInput = {
  policyId: string;
  versionId: string | null;
  reason: 'issuance' | 'endorsement';
  premiumMinor: Minor;
  surcharges: Surcharge[];
  effectiveDate: IsoDate;
  actor: string;
};

export type CollectResult = {
  chargeId: string;
  checkoutUrl: string;
  totalMinor: Minor;
};

export async function createPremiumCheckout(input: CollectInput): Promise<CollectResult> {
  await assertStripeUp();

  const surchargeTotal = input.surcharges.reduce((t, s) => t + s.amountMinor, 0n);
  const total = input.premiumMinor + surchargeTotal;
  if (total <= 0n) throw new Error('nothing to collect');

  const [policy] = await sql<
    { policy_number: string; state_code: string; customer_email: string; customer_name: string }[]
  >`
    select p.policy_number, p.state_code, c.email as customer_email, c.legal_name as customer_name
      from policies p join customers c on c.id = p.customer_id
     where p.id = ${input.policyId}::uuid
  `;
  if (!policy) throw new Error('policy not found');

  const chargeId = crypto.randomUUID();
  const base = process.env.APP_URL ?? '';

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer_email: policy.customer_email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Number(input.premiumMinor),
            product_data: {
              name: `${policy.policy_number} — ${input.reason === 'issuance' ? 'annual premium' : 'endorsement premium'}`,
              description: `Effective ${input.effectiveDate}`,
            },
          },
        },
        ...input.surcharges
          .filter((s) => s.amountMinor > 0n)
          .map((s) => ({
            quantity: 1,
            price_data: {
              currency: 'usd' as const,
              unit_amount: Number(s.amountMinor),
              product_data: {
                name: `${policy.state_code} ${s.label}`,
                description: s.basis,
              },
            },
          })),
      ],
      payment_intent_data: {
        metadata: {
          charge_id: chargeId,
          policy_id: input.policyId,
          policy_number: policy.policy_number,
        },
      },
      metadata: {
        charge_id: chargeId,
        policy_id: input.policyId,
        policy_number: policy.policy_number,
      },
      success_url: `${base}/paid?policy=${input.policyId}`,
      cancel_url: `${base}/broker/policies?cancelled=1`,
    },
    { idempotencyKey: `checkout:${chargeId}` },
  );

  if (!session.url) throw new Error('Stripe returned a session without a URL');

  await sql.begin(async (tx) => {
    await tx`
      insert into premium_charges (id, policy_id, version_id, reason, premium_minor, surcharge_minor,
                                   total_minor, provider, checkout_ref, effective_date, created_by)
      values (${chargeId}::uuid, ${input.policyId}::uuid, ${input.versionId}::uuid, ${input.reason},
              ${input.premiumMinor.toString()}::bigint, ${surchargeTotal.toString()}::bigint,
              ${total.toString()}::bigint, 'stripe', ${session.id}, ${input.effectiveDate}::date,
              ${input.actor})
    `;
    await tx`
      insert into charge_events (charge_id, kind, amount_minor, provider_ref, detail)
      values (${chargeId}::uuid, 'checkout_created', ${total.toString()}::bigint, ${session.id},
              ${sql.json({ surcharges: input.surcharges.map((s) => s.label) })}::jsonb)
    `;
  });

  return { chargeId, checkoutUrl: session.url, totalMinor: total };
}
