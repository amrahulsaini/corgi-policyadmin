'use client';

import { useActionState } from 'react';
import { run, type ReconState } from './actions';

export default function RunForm({ defaultMonth }: { defaultMonth: string }) {
  const [state, action, pending] = useActionState<ReconState, FormData>(run, {
    error: null,
    notice: null,
  });

  return (
    <form action={action} className="card p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="month" className="block text-xs font-semibold mb-1.5">
            Period
          </label>
          <input
            id="month"
            name="month"
            type="month"
            defaultValue={defaultMonth}
            className="field num w-48"
          />
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Pulling from Stripe…' : 'Run reconciliation'}
        </button>
        <p className="text-xs text-[var(--ink-soft)] max-w-sm">
          Calls Stripe for the period and compares every settled payment against this ledger. Safe to
          run repeatedly.
        </p>
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
    </form>
  );
}
