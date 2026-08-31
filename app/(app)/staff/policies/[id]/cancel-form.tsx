'use client';

import { useActionState } from 'react';
import { cancel, type ActionState } from './actions';

export default function CancelForm({
  policyId,
  termStart,
  termEnd,
}: {
  policyId: string;
  termStart: string;
  termEnd: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancel, {
    error: null,
    notice: null,
  });

  return (
    <form action={action} className="px-4 py-4 space-y-4">
      <input type="hidden" name="policyId" value={policyId} />

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="cancelDate" className="block text-xs font-semibold mb-1.5">
            Cancellation effective
          </label>
          <input
            id="cancelDate"
            name="effectiveDate"
            type="date"
            min={termStart}
            max={termEnd}
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="field num"
          />
        </div>

        <div>
          <label htmlFor="method" className="block text-xs font-semibold mb-1.5">
            Basis
          </label>
          <select id="method" name="method" className="field" defaultValue="pro_rata">
            <option value="pro_rata">Pro rata — return every unearned day</option>
            <option value="short_rate">Short rate — retain a 10% penalty</option>
          </select>
        </div>

        <div>
          <label htmlFor="cancelReason" className="block text-xs font-semibold mb-1.5">
            Reason
          </label>
          <input
            id="cancelReason"
            name="reason"
            defaultValue="Insured requested cancellation"
            className="field"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--good)] bg-[var(--good-soft)] rounded-md px-3 py-2">
          {state.notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Cancelling…' : 'Cancel and refund'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          The refund goes back through Stripe&apos;s refund API on the original payment, not as a
          ledger row that claims it did.
        </p>
      </div>
    </form>
  );
}
