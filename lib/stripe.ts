import Stripe from 'stripe';

declare global {
  var __corgiStripe: Stripe | undefined;
}

function connect() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  if (key.startsWith('sk_live')) {
    throw new Error('refusing to start with a live Stripe key');
  }
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 12_000 });
}

export const stripe = globalThis.__corgiStripe ?? connect();

if (process.env.NODE_ENV !== 'production') globalThis.__corgiStripe = stripe;

export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return secret;
}
