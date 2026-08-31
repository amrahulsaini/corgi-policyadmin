import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';

export type BankVerification = {
  provider: 'plaid' | 'simulator';
  live: boolean;
  reference: string;
  accountMask: string;
  routingNumber: string;
  accountHolder: string;
  nameMatches: boolean;
  note: string;
};

export function bankProviderIsLive(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

async function plaidCall<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const env = process.env.PLAID_ENV ?? 'sandbox';
  if (env !== 'sandbox') throw new Error('refusing to call Plaid outside the sandbox environment');

  const response = await fetch(`https://sandbox.plaid.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Plaid ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function verifyWithPlaid(expectedName: string): Promise<BankVerification> {
  const created = await plaidCall<{ public_token: string }>('/sandbox/public_token/create', {
    institution_id: 'ins_109508',
    initial_products: ['auth'],
  });

  const exchanged = await plaidCall<{ access_token: string; item_id: string }>(
    '/item/public_token/exchange',
    { public_token: created.public_token },
  );

  const auth = await plaidCall<{
    accounts: { account_id: string; name: string; mask: string | null }[];
    numbers: { ach: { account_id: string; account: string; routing: string }[] };
  }>('/auth/get', { access_token: exchanged.access_token });

  const identity = await plaidCall<{
    accounts: { owners: { names: string[] }[] }[];
  }>('/identity/get', { access_token: exchanged.access_token });

  const ach = auth.numbers.ach[0];
  if (!ach) throw new Error('Plaid returned no ACH-capable account');

  const account = auth.accounts.find((a) => a.account_id === ach.account_id);
  const owners = identity.accounts.flatMap((a) => a.owners.flatMap((o) => o.names));
  const holder = owners[0] ?? 'unknown';

  return {
    provider: 'plaid',
    live: true,
    reference: exchanged.item_id,
    accountMask: account?.mask ?? ach.account.slice(-4),
    routingNumber: ach.routing,
    accountHolder: holder,
    nameMatches: namesAgree(holder, expectedName),
    note: `Plaid sandbox auth and identity returned ${owners.length} owner name(s) on the account.`,
  };
}

function simulate(accountOwner: string, payeeName: string): BankVerification {
  const digest = createHash('sha256').update(accountOwner.toLowerCase()).digest('hex');
  const routing = `0${digest.slice(0, 8).replace(/\D/g, '1').padEnd(8, '2')}`.slice(0, 9);
  const mask = digest.slice(8, 12).replace(/\D/g, '7').padEnd(4, '4').slice(0, 4);

  return {
    provider: 'simulator',
    live: false,
    reference: `sim_${digest.slice(0, 16)}`,
    accountMask: mask,
    routingNumber: routing,
    accountHolder: accountOwner,
    nameMatches: namesAgree(accountOwner, payeeName),
    note: 'Simulated bank verification behind the same interface as the live provider. The account belongs to the named insured; a payee who is not that party fails the check.',
  };
}

export function namesAgree(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(llc|inc|co|corp|ltd|limited|company)\b/g, '')
      .replace(/[^a-z ]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const left = norm(a);
  const right = norm(b);
  if (left.length === 0 || right.length === 0) return false;
  const overlap = left.filter((t) => right.includes(t)).length;
  return overlap >= Math.min(left.length, right.length);
}

export async function verifyPayee(input: {
  claimId: string;
  payeeName: string;
}): Promise<BankVerification> {
  const [owner] = await sql<{ legal_name: string }[]>`
    select c.legal_name
      from claims cl
      join policies p on p.id = cl.policy_id
      join customers c on c.id = p.customer_id
     where cl.id = ${input.claimId}::uuid
  `;
  if (!owner) throw new Error('claim not found');

  const result = bankProviderIsLive()
    ? await verifyWithPlaid(input.payeeName)
    : simulate(owner.legal_name, input.payeeName);

  await sql`
    update claims
       set payee_account_verified = ${result.nameMatches},
           payee_provider = ${result.provider},
           payee_reference = ${result.reference}
     where id = ${input.claimId}::uuid
  `;

  await sql`
    insert into decision_events (actor, action, subject, detail)
    values ('system', 'claim.payee_verified', ${input.claimId},
            ${sql.json({
              provider: result.provider,
              live: String(result.live),
              nameMatches: String(result.nameMatches),
              accountHolder: result.accountHolder,
              mask: result.accountMask,
            })}::jsonb)
  `;

  return result;
}
