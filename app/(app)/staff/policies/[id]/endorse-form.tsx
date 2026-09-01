'use client';

import { useActionState } from 'react';
import { endorse, type ActionState } from './actions';

export default function EndorseForm({
  policyId,
  termStart,
  termEnd,
  currentLimit,
  currentDeductible,
  currentVehicles,
  currentSquareFeet,
  thresholdLabel,
}: {
  policyId: string;
  termStart: string;
  termEnd: string;
  currentLimit: string;
  currentDeductible: string;
  currentVehicles: number;
  currentSquareFeet: number;
  thresholdLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(endorse, {
    error: null,
    notice: null,
    link: null,
  });

  return (
    <form action={action} className="px-4 py-4 space-y-4">
      <input type="hidden" name="policyId" value={policyId} />

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="effectiveDate" className="block text-xs font-semibold mb-1.5">
            Effective date
          </label>
          <input
            id="effectiveDate"
            name="effectiveDate"
            type="date"
            min={termStart}
            max={termEnd}
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            Priced from this date, not from today.
          </p>
        </div>

        <div>
          <label htmlFor="limit" className="block text-xs font-semibold mb-1.5">
            Occurrence limit
          </label>
          <select id="limit" name="limit" className="field num" defaultValue={currentLimit}>
            <option value="1000000.00">$1,000,000</option>
            <option value="2000000.00">$2,000,000</option>
            <option value="5000000.00">$5,000,000</option>
          </select>
        </div>

        <div>
          <label htmlFor="deductible" className="block text-xs font-semibold mb-1.5">
            Deductible
          </label>
          <select
            id="deductible"
            name="deductible"
            className="field num"
            defaultValue={currentDeductible}
          >
            <option value="1000.00">$1,000</option>
            <option value="2500.00">$2,500</option>
            <option value="5000.00">$5,000</option>
            <option value="10000.00">$10,000</option>
          </select>
        </div>

        <div>
          <label htmlFor="vehicles" className="block text-xs font-semibold mb-1.5">
            Scheduled vehicles after this change
          </label>
          <input
            id="vehicles"
            name="vehicles"
            type="number"
            min={0}
            max={50}
            defaultValue={currentVehicles}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            {currentVehicles} on the policy today. This is the new total, not how many to add — to
            put a fourth on cover, type {currentVehicles + 1}.
          </p>
        </div>

        <div>
          <label htmlFor="squareFeet" className="block text-xs font-semibold mb-1.5">
            Floor area after this change (sq ft)
          </label>
          <input
            id="squareFeet"
            name="squareFeet"
            type="number"
            min={0}
            max={500000}
            step={100}
            defaultValue={currentSquareFeet}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            {currentSquareFeet.toLocaleString()} sq ft scheduled today. The whole schedule is
            rewritten at this date, so every version can be read on its own.
          </p>
        </div>

        <div className="sm:col-span-1">
          <label htmlFor="description" className="block text-xs font-semibold mb-1.5">
            What changes
          </label>
          <input
            id="description"
            name="description"
            placeholder="Add a fourth scheduled vehicle"
            className="field"
          />
        </div>
      </div>

      <label className="flex items-start gap-2.5 rounded-md bg-[var(--line-soft)] px-3 py-2.5">
        <input
          type="checkbox"
          name="settleNow"
          defaultChecked
          className="mt-0.5 accent-[var(--accent)]"
        />
        <span className="text-xs">
          <span className="font-semibold">Move the money too</span>
          <span className="block text-[var(--ink-soft)] mt-0.5">
            More premium raises a Stripe checkout for the insured. Less premium sends a real Stripe
            refund against the payment they already made. Leave it off to book the endorsement and
            let the balance stand as a receivable or a payable.
          </span>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <div className="text-sm text-[var(--good)] bg-[var(--good-soft)] rounded-md px-3 py-2 space-y-2">
          <p>{state.notice}</p>
          {state.link ? (
            <a
              href={state.link}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost text-xs"
            >
              Open the payment link
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Pricing…' : 'Book endorsement'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          Anything above {thresholdLabel} goes to a second approver instead of posting.
        </p>
      </div>
    </form>
  );
}
