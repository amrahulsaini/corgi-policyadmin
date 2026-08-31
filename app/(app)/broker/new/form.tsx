'use client';

import { useActionState } from 'react';
import { bindAndCollect, type QuoteState } from './actions';

const LIMITS = ['1000000.00', '2000000.00', '5000000.00'];
const DEDUCTIBLES = ['1000.00', '2500.00', '5000.00', '10000.00'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function QuoteForm({
  customers,
}: {
  customers: { id: string; legal_name: string; state_code: string }[];
}) {
  const [state, action, pending] = useActionState<QuoteState, FormData>(bindAndCollect, {
    error: null,
  });

  return (
    <form action={action} className="card p-5 space-y-5">
      <div>
        <label htmlFor="customerId" className="block text-xs font-semibold mb-1.5">
          Named insured
        </label>
        <select id="customerId" name="customerId" className="field" defaultValue={customers[0]?.id}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name} ({c.state_code})
            </option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="termStart" className="block text-xs font-semibold mb-1.5">
            Inception date
          </label>
          <input
            id="termStart"
            name="termStart"
            type="date"
            defaultValue={today()}
            className="field num"
          />
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            The term runs to the anniversary, not to day 365.
          </p>
        </div>

        <div>
          <label htmlFor="limit" className="block text-xs font-semibold mb-1.5">
            Occurrence limit
          </label>
          <select id="limit" name="limit" className="field num" defaultValue={LIMITS[0]}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                ${Number(l).toLocaleString('en-US')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="deductible" className="block text-xs font-semibold mb-1.5">
            Deductible
          </label>
          <select id="deductible" name="deductible" className="field num" defaultValue={DEDUCTIBLES[1]}>
            {DEDUCTIBLES.map((d) => (
              <option key={d} value={d}>
                ${Number(d).toLocaleString('en-US')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="vehicles" className="block text-xs font-semibold mb-1.5">
            Scheduled vehicles
          </label>
          <input
            id="vehicles"
            name="vehicles"
            type="number"
            min={0}
            max={50}
            defaultValue={3}
            className="field num"
          />
        </div>
      </div>

      <div>
        <label htmlFor="squareFeet" className="block text-xs font-semibold mb-1.5">
          Premises floor area (sq ft)
        </label>
        <input
          id="squareFeet"
          name="squareFeet"
          type="number"
          min={0}
          max={500000}
          step={100}
          defaultValue={12000}
          className="field num"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Binding…' : 'Bind and collect premium'}
        </button>
        <p className="text-xs text-[var(--ink-soft)]">
          Opens Stripe test checkout. Card <span className="num">4242 4242 4242 4242</span>, any
          future expiry, any CVC.
        </p>
      </div>
    </form>
  );
}
