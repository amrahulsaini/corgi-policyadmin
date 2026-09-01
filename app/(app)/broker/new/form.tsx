'use client';

import { useActionState, useEffect, useState } from 'react';
import { bindAndCollect, quoteRisk, type BindQuote, type QuoteState } from './actions';
import { FILED_STATES } from './filed-states';

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

  const [newState, setNewState] = useState('CA');
  const [termStart, setTermStart] = useState(today());
  const [limit, setLimit] = useState(LIMITS[0]);
  const [deductible, setDeductible] = useState(DEDUCTIBLES[1]);
  const [vehicles, setVehicles] = useState('3');
  const [squareFeet, setSquareFeet] = useState('12000');

  const [quote, setQuote] = useState<BindQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    let live = true;
    setQuoting(true);
    const timer = setTimeout(() => {
      quoteRisk({
        customerId: insured,
        newState,
        termStart,
        limit,
        deductible,
        vehicles: Number(vehicles),
        squareFeet: Number(squareFeet),
      })
        .then((next) => {
          if (live) setQuote(next);
        })
        .finally(() => {
          if (live) setQuoting(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [insured, newState, termStart, limit, deductible, vehicles, squareFeet]);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px] gap-6 items-start">
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
            <select
              id="newState"
              name="newState"
              className="field"
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
            >
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
            value={termStart}
            onChange={(e) => setTermStart(e.target.value)}
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
          <select
            id="limit"
            name="limit"
            className="field num"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          >
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
          <select
            id="deductible"
            name="deductible"
            className="field num"
            value={deductible}
            onChange={(e) => setDeductible(e.target.value)}
          >
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
            value={vehicles}
            onChange={(e) => setVehicles(e.target.value)}
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
          value={squareFeet}
          onChange={(e) => setSquareFeet(e.target.value)}
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

      <aside className="lg:sticky lg:top-20">
        <QuoteBox quote={quote} quoting={quoting} />
      </aside>
    </div>
  );
}

function QuoteBox({ quote, quoting }: { quote: BindQuote | null; quoting: boolean }) {
  if (!quote) {
    return (
      <div className="card p-4 text-xs text-[var(--ink-faint)]">
        {quoting ? 'Rating…' : 'Fill the risk in and the premium appears here before you bind.'}
      </div>
    );
  }

  if (quote.error) {
    return (
      <div className="card p-4 bg-[var(--bad-soft)] text-[var(--bad)] text-xs">{quote.error}</div>
    );
  }

  return (
    <div className={`card overflow-hidden transition-opacity ${quoting ? 'opacity-60' : ''}`}>
      <div className="px-4 py-3 border-b rule bg-[var(--accent-soft)]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          Payable at checkout
        </span>
        <div className="num text-2xl font-semibold mt-0.5">{quote.total}</div>
        <p className="text-[11px] text-[var(--ink-soft)] mt-1">
          Term {quote.termStart} to {quote.termEnd} · rates filed in {quote.stateCode}
        </p>
      </div>

      <div className="px-4 py-3 space-y-4 text-xs">
        <div>
          <div className="font-semibold mb-1.5">How the premium is rated</div>
          <table className="sheet">
            <tbody>
              {quote.components.map((c, i) => (
                <tr key={i}>
                  <td>
                    {c.label}
                    <div className="text-[10px] text-[var(--ink-faint)]">{c.basis}</div>
                  </td>
                  <td className="num text-right align-top">{c.amount}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Annual premium</td>
                <td className="num text-right font-semibold">{quote.annualPremium}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div className="font-semibold mb-1.5">What rides alongside it</div>
          <table className="sheet">
            <tbody>
              <tr>
                <td>Annual premium</td>
                <td className="num text-right">{quote.annualPremium}</td>
              </tr>
              {quote.surcharges.map((s, i) => (
                <tr key={i}>
                  <td>
                    {s.label}
                    <div className="text-[10px] text-[var(--ink-faint)]">{s.basis}</div>
                  </td>
                  <td className="num text-right align-top">{s.amount}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Charged to the insured</td>
                <td className="num text-right font-semibold">{quote.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="px-4 py-3 border-t rule bg-[var(--line-soft)] text-[11px] text-[var(--ink-soft)]">
        Taxes and fees are collected with the premium but are never part of it. Commission is a share
        of the premium alone, and it books when this settles — not when you bind.
      </p>
    </div>
  );
}
