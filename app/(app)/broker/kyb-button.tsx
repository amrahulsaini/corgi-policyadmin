'use client';

import { useActionState } from 'react';
import { beginKyb, type KybState } from './actions';

export default function KybButton({ status }: { status: string }) {
  const [state, action, pending] = useActionState<KybState, FormData>(beginKyb, { error: null });

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
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
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error} Binding stays closed, which is the safe direction when a provider is
          unreachable.
        </p>
      ) : null}
    </form>
  );
}
