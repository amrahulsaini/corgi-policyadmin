'use client';

import { useActionState } from 'react';
import { beginKyb, checkKybNow, type KybState } from './actions';

export default function KybButton({ status }: { status: string }) {
  const [state, action, pending] = useActionState<KybState, FormData>(beginKyb, { error: null });
  const [checkState, checkAction, checking] = useActionState<KybState, FormData>(checkKybNow, {
    error: null,
  });

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary text-sm">
          {pending
            ? 'Opening the provider…'
            : status === 'pending'
              ? 'Resume verification'
              : status === 'failed'
                ? 'Try verification again'
                : 'Start business verification'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          Opens a live Persona sandbox inquiry. Use their published test identity — never real
          personal data.
        </p>
      </form>

      {status === 'pending' ? (
        <form action={checkAction} className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={checking} className="btn btn-ghost text-xs">
            {checking ? 'Asking the provider…' : 'Check status now'}
          </button>
          <p className="text-xs text-[var(--ink-soft)]">
            The webhook is how this normally updates. This button polls the provider directly, for
            when a delivery is late or was never sent.
          </p>
        </form>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error} Binding stays closed, which is the safe direction when a provider is
          unreachable.
        </p>
      ) : null}
      {checkState.error ? (
        <p className="text-sm text-[var(--warn)] bg-[var(--warn-soft)] rounded-md px-3 py-2">
          {checkState.error}
        </p>
      ) : null}
    </div>
  );
}
