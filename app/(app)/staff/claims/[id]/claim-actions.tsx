'use client';

import { useActionState } from 'react';
import { adjust, pay, reverify, type ClaimState } from './actions';

const EMPTY: ClaimState = { error: null, notice: null };

export default function ClaimActions({
  claimId,
  canPay,
  reserveLabel,
}: {
  claimId: string;
  canPay: boolean;
  reserveLabel: string;
}) {
  const [adjustState, adjustAction, adjusting] = useActionState<ClaimState, FormData>(adjust, EMPTY);
  const [payState, payAction, paying] = useActionState<ClaimState, FormData>(pay, EMPTY);
  const [verifyState, verifyAction, verifying] = useActionState<ClaimState, FormData>(
    reverify,
    EMPTY,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Move the reserve</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            Currently holding {reserveLabel}. An estimate is allowed to change; the change is
            appended.
          </p>
        </div>
        <form action={adjustAction} className="px-4 py-4 space-y-3">
          <input type="hidden" name="claimId" value={claimId} />
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="direction" className="block text-xs font-semibold mb-1.5">
                Direction
              </label>
              <select id="direction" name="direction" className="field" defaultValue="increase">
                <option value="increase">Increase</option>
                <option value="release">Release</option>
              </select>
            </div>
            <div>
              <label htmlFor="adjAmount" className="block text-xs font-semibold mb-1.5">
                Amount
              </label>
              <input id="adjAmount" name="amount" defaultValue="5000.00" className="field num" />
            </div>
            <div>
              <label htmlFor="adjDate" className="block text-xs font-semibold mb-1.5">
                Effective
              </label>
              <input
                id="adjDate"
                name="effectiveDate"
                type="date"
                defaultValue={today}
                className="field num"
              />
            </div>
          </div>
          <div>
            <label htmlFor="adjMemo" className="block text-xs font-semibold mb-1.5">
              Why
            </label>
            <input
              id="adjMemo"
              name="memo"
              defaultValue="Adjuster report revised the estimate"
              className="field"
            />
          </div>
          <Feedback state={adjustState} />
          <button type="submit" disabled={adjusting} className="btn btn-ghost text-sm">
            {adjusting ? 'Adjusting…' : 'Adjust reserve'}
          </button>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b rule">
          <h2 className="font-semibold text-sm">Pay the claim</h2>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">
            A payment draws the reserve down. It cannot exceed the reserve or the occurrence limit.
          </p>
        </div>
        <form action={payAction} className="px-4 py-4 space-y-3">
          <input type="hidden" name="claimId" value={claimId} />
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="payAmount" className="block text-xs font-semibold mb-1.5">
                Amount
              </label>
              <input id="payAmount" name="amount" defaultValue="10000.00" className="field num" />
            </div>
            <div>
              <label htmlFor="payDate" className="block text-xs font-semibold mb-1.5">
                Effective
              </label>
              <input
                id="payDate"
                name="effectiveDate"
                type="date"
                defaultValue={today}
                className="field num"
              />
            </div>
          </div>
          <div>
            <label htmlFor="payMemo" className="block text-xs font-semibold mb-1.5">
              What it settles
            </label>
            <input
              id="payMemo"
              name="memo"
              defaultValue="Partial indemnity payment to claimant"
              className="field"
            />
          </div>
          <Feedback state={payState} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={paying || !canPay}
              className="btn btn-primary text-sm"
            >
              {paying ? 'Paying…' : 'Issue payment'}
            </button>
            {!canPay ? (
              <span className="text-xs text-[var(--warn)]">
                Blocked until the payee bank account verifies.
              </span>
            ) : null}
          </div>
        </form>

        <form action={verifyAction} className="px-4 py-3 border-t rule space-y-2">
          <input type="hidden" name="claimId" value={claimId} />
          <Feedback state={verifyState} />
          <button type="submit" disabled={verifying} className="btn btn-ghost text-xs">
            {verifying ? 'Checking the bank…' : 'Re-run the bank check'}
          </button>
        </form>
      </section>
    </div>
  );
}

function Feedback({ state }: { state: ClaimState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="text-sm text-[var(--good)] bg-[var(--good-soft)] rounded-md px-3 py-2">
        {state.notice}
      </p>
    );
  }
  return null;
}
