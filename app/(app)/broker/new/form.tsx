'use client';

import { useActionState, useState } from 'react';
import { bindAndCollect, FILED_STATES, type QuoteState } from './actions';

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
  const [insured, setInsured] = useState(customers[0]?.id ?? 'new');
  const isNew = insured === 'new';

  return (
    <form action={action} className="card p-5 space-y-5">
      <div>
        <label htmlFor="customerId" className="block text-xs font-semibold mb-1.5">
          Named insured
        </label>
        <select
          id="customerId"
          name="customerId"
          className="field"
          value={insured}
          onChange={(e) => setInsured(e.target.value)}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legal_name} ({c.state_code})
            </option>
          ))}
          <option value="new">＋ A business not on file yet</option>
        </select>
        <p className="text-[11px] text-[var(--ink-faint)] mt-1">
          The business buying the cover. Their state decides which filed taxes and fees apply.
        </p>
      </div>

      {isNew ? (
        <div className="grid sm:grid-cols-2 gap-4 rounded-md bg-[var(--line-soft)] p-4">
          <div className="sm:col-span-2">
            <label htmlFor="newLegalName" className="block text-xs font-semibold mb-1.5">
              Legal name
            </label>
            <input
              id="newLegalName"
              name="newLegalName"
              placeholder="Ridgeline Coatings LLC"
              className="field"
            />
            <p className="text-[11px] text-[var(--ink-faint)] mt-1">
              Exactly as registered. This is the name printed on the declarations page, and the name a
              claim payee is checked against.
            </p>
          </div>

          <div>
            <label htmlFor="newEmail" className="block text-xs font-semibold mb-1.5">
              Contact email
            </label>
            <input
              id="newEmail"
              name="newEmail"
              type="email"
              placeholder="ops@ridgeline.test"
              className="field num"
            />
          </div>

          <div>
            <label htmlFor="newState" className="block text-xs font-semibold mb-1.5">
              Risk state
            </label>
            <select id="newState" name="newState" className="field" defaultValue="CA">
              {FILED_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--ink-faint)] mt-1">
              Only states this product is filed in.
            </p>
          </div>
        </div>
      ) : null}

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
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            The most payable for any one incident.
          </p>
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
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            What the insured absorbs first. A higher one earns a filed credit.
          </p>
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
          <p className="text-[11px] text-[var(--ink-faint)] mt-1">
            Listed individually, not on a blanket.
          </p>
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
