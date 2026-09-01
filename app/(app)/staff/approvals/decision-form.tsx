'use client';

import { useActionState } from 'react';
import { decide, type DecisionState } from './actions';

export default function DecisionForm({ approvalId }: { approvalId: string }) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decide, {
    error: null,
    notice: null,
  });

  return (
    <form action={action} className="px-4 py-3 border-t rule space-y-3">
      <input type="hidden" name="approvalId" value={approvalId} />

      <div>
        <label htmlFor={`note-${approvalId}`} className="block text-xs font-semibold mb-1.5">
          Decision note
        </label>
        <input
          id={`note-${approvalId}`}
          name="note"
          placeholder="Checked the schedule against the broker's email"
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

      <div className="flex gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="btn btn-primary text-sm"
        >
          Approve and post
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          disabled={pending}
          className="btn btn-ghost text-sm"
        >
          Reject
        </button>
      </div>
    </form>
  );
}
