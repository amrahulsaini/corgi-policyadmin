'use client';

import { useActionState } from 'react';
import { fileClaim, type ActionState } from './actions';

export default function ClaimForm({
  policyId,
  termStart,
  termEnd,
  coverEnd,
  insuredName,
}: {
  policyId: string;
  termStart: string;
  termEnd: string;
  coverEnd: string;
  insuredName: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(fileClaim, {
    error: null,
    notice: null,
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="px-4 py-4 space-y-4">
      <input type="hidden" name="policyId" value={policyId} />

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="lossDate" className="block text-xs font-semibold mb-1.5">
            Date of loss
          </label>
          <input
            id="lossDate"
            name="lossDate"
            type="date"
            min={termStart}
            max={coverEnd}
            defaultValue={today > coverEnd ? coverEnd : today}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            {coverEnd === termEnd
              ? 'Must fall inside the term. The limit in force on this date is the one that applies.'
              : `Cover ran ${termStart} to ${coverEnd}, when the policy was cancelled. A loss inside that window is still claimable; one after it is not.`}
          </p>
        </div>

        <div>
          <label htmlFor="reportedDate" className="block text-xs font-semibold mb-1.5">
            Date reported
          </label>
          <input
            id="reportedDate"
            name="reportedDate"
            type="date"
            defaultValue={today}
            className="field num"
          />
        </div>

        <div>
          <label htmlFor="reserve" className="block text-xs font-semibold mb-1.5">
            Opening reserve
          </label>
          <input id="reserve" name="reserve" defaultValue="25000.00" className="field num" />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="payeeName" className="block text-xs font-semibold mb-1.5">
            Payee
          </label>
          <input id="payeeName" name="payeeName" defaultValue={insuredName} className="field" />
        </div>
        <div>
          <label htmlFor="claimDescription" className="block text-xs font-semibold mb-1.5">
            What happened
          </label>
          <input
            id="claimDescription"
            name="description"
            defaultValue="Third-party bodily injury at insured premises"
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
          {pending ? 'Opening…' : 'Open claim and verify payee'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          Opening a claim establishes a reserve and runs a bank-account check on the payee. Nothing
          pays out until the account holder matches.
        </p>
      </div>
    </form>
  );
}
