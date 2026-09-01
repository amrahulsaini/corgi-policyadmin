'use client';

import { useActionState } from 'react';
import { correct, type ActionState } from './actions';

export default function CorrectForm({
  policyId,
  termStart,
  termEnd,
  candidates,
}: {
  policyId: string;
  termStart: string;
  termEnd: string;
  candidates: { id: string; versionNo: number; effectiveDate: string; description: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(correct, {
    error: null,
    notice: null,
  });

  if (candidates.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
        Nothing to correct. Book an endorsement first, then a wrong effective date can be put right
        here.
      </p>
    );
  }

  return (
    <form action={action} className="px-4 py-4 space-y-4">
      <input type="hidden" name="policyId" value={policyId} />

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="versionId" className="block text-xs font-semibold mb-1.5">
            Endorsement entered with the wrong date
          </label>
          <select id="versionId" name="versionId" className="field" defaultValue={candidates[0].id}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                v{c.versionNo} · effective {c.effectiveDate} · {c.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="correctedEffectiveDate" className="block text-xs font-semibold mb-1.5">
            The date it should have been
          </label>
          <input
            id="correctedEffectiveDate"
            name="correctedEffectiveDate"
            type="date"
            min={termStart}
            max={termEnd}
            className="field num"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="block text-xs font-semibold mb-1.5">
          Reason for the correction
        </label>
        <input
          id="reason"
          name="reason"
          defaultValue="Effective date keyed in error at entry"
          className="field"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <div className="text-sm text-[var(--good)] bg-[var(--good-soft)] rounded-md px-3 py-2 space-y-2">
          <p>{state.notice}</p>
          {state.link ? (
            <a href={state.link} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs">
              Open the payment link
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Correcting…' : 'Reverse and re-book'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          The original entry is never touched. A reversal is posted at the old date and a fresh entry
          at the right one.
        </p>
      </div>
    </form>
  );
}
