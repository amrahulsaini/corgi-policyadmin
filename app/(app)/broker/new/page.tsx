import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { sql } from '@/lib/db';
import QuoteForm from './form';

export const dynamic = 'force-dynamic';

export default async function NewBusiness() {
  const user = await requireRole('broker');

  const [broker] = await sql<{ name: string; kyb_status: string }[]>`
    select name, kyb_status from brokers where id = ${user.brokerId}::uuid
  `;

  if (broker.kyb_status !== 'approved') {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">New business</h1>
        <div className="card p-5 border-[var(--warn)]">
          <span className="chip chip-warn">{broker.kyb_status}</span>
          <p className="mt-3 text-sm">
            {broker.name} cannot bind business until the agency passes a business verification check.
          </p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            This is enforced at issuance, not only in the interface — the service layer refuses the
            bind regardless of how the request arrives.
          </p>
          <Link href="/broker" className="btn btn-ghost mt-4 text-xs">
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  const customers = await sql<{ id: string; legal_name: string; state_code: string }[]>`
    select id, legal_name, state_code from customers order by legal_name
  `;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quote and bind</h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">
          Commercial general liability. Binding rates the risk, opens the premium layer, posts the
          journal entry, and hands the insured a payment page in one transaction.
        </p>
      </div>

      <QuoteForm customers={customers} />
    </div>
  );
}
