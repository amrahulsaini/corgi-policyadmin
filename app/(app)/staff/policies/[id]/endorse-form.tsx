'use client';

import { useActionState, useState } from 'react';
import { endorse, type ActionState } from './actions';

export type Baseline = {
  effectiveDate: string;
  limit: string;
  deductible: string;
  vehicles: number;
  squareFeet: number;
};

function baselineOn(schedule: Baseline[], date: string): Baseline | null {
  const standing = schedule.filter((s) => s.effectiveDate <= date);
  return standing.length ? standing[standing.length - 1] : null;
}

export default function EndorseForm({
  policyId,
  termStart,
  termEnd,
  schedule,
  thresholdLabel,
}: {
  policyId: string;
  termStart: string;
  termEnd: string;
  schedule: Baseline[];
  thresholdLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(endorse, {
    error: null,
    notice: null,
    link: null,
  });

  const today = new Date().toISOString().slice(0, 10);
  const start = today > termEnd ? termEnd : today < termStart ? termStart : today;

  const [effectiveDate, setEffectiveDate] = useState(start);
  const [base, setBase] = useState(() => baselineOn(schedule, start) ?? schedule[0]);
  const [limit, setLimit] = useState(base?.limit ?? '1000000.00');
  const [deductible, setDeductible] = useState(base?.deductible ?? '2500.00');
  const [vehicles, setVehicles] = useState(String(base?.vehicles ?? 0));
  const [squareFeet, setSquareFeet] = useState(String(base?.squareFeet ?? 0));

  const later = schedule.filter((s) => s.effectiveDate > effectiveDate);

  function pickDate(next: string) {
    setEffectiveDate(next);
    const found = baselineOn(schedule, next) ?? schedule[0];
    setBase(found);
    setLimit(found.limit);
    setDeductible(found.deductible);
    setVehicles(String(found.vehicles));
    setSquareFeet(String(found.squareFeet));
  }

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
            value={effectiveDate}
            onChange={(e) => pickDate(e.target.value)}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            Priced from this date, not from today. Everything below is seeded from the cover standing
            on it.
          </p>
        </div>

        <div>
          <label htmlFor="limit" className="block text-xs font-semibold mb-1.5">
            Occurrence limit
          </label>
          <select
            id="limit"
            name="limit"
            className="field num"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
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
            value={deductible}
            onChange={(e) => setDeductible(e.target.value)}
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
            value={vehicles}
            onChange={(e) => setVehicles(e.target.value)}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            {base?.vehicles ?? 0} on cover at {effectiveDate}. This is the new total, not how many to
            add — for one more, type {(base?.vehicles ?? 0) + 1}.
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
            value={squareFeet}
            onChange={(e) => setSquareFeet(e.target.value)}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            {(base?.squareFeet ?? 0).toLocaleString()} sq ft at {effectiveDate}. The whole schedule is
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

      {later.length > 0 ? (
        <p className="text-xs text-[var(--warn)] bg-[var(--warn-soft)] rounded-md px-3 py-2">
          {later.length === 1 ? 'A later version is' : `${later.length} later versions are`} already
          booked on this policy, effective{' '}
          <span className="num">{later.map((s) => s.effectiveDate).join(', ')}</span>. This
          endorsement prices against {effectiveDate}, not against them, and it does not undo them.
        </p>
      ) : null}

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
            <a href={state.link} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs">
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
