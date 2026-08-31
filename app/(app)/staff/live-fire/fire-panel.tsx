'use client';

import { useActionState } from 'react';
import {
  correctPlanted,
  forgeWebhook,
  plantBreak,
  replayWebhook,
  tamperTest,
  toggleOutage,
  type FireState,
} from './actions';

const EMPTY: FireState = { error: null, notice: null };

export default function FirePanel({
  outageOn,
  planted,
}: {
  outageOn: boolean;
  planted: { id: string; ref: string; memo: string }[];
}) {
  const [tamperState, tamperAction, tampering] = useActionState<FireState, FormData>(
    tamperTest,
    EMPTY,
  );
  const [replayState, replayAction, replaying] = useActionState<FireState, FormData>(
    replayWebhook,
    EMPTY,
  );
  const [forgeState, forgeAction, forging] = useActionState<FireState, FormData>(
    forgeWebhook,
    EMPTY,
  );
  const [plantState, plantAction, planting] = useActionState<FireState, FormData>(
    plantBreak,
    EMPTY,
  );
  const [fixState, fixAction, fixing] = useActionState<FireState, FormData>(correctPlanted, EMPTY);
  const [outageState, outageAction, toggling] = useActionState<FireState, FormData>(
    toggleOutage,
    EMPTY,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card
        title="Try to edit a money row"
        blurb="Runs UPDATE and DELETE against the journal as the application's own database user. Both should be refused by the database itself, then the hash chain is recomputed across every entry."
      >
        <form action={tamperAction}>
          <button type="submit" disabled={tampering} className="btn btn-ghost text-sm">
            {tampering ? 'Trying…' : 'Attempt UPDATE and DELETE'}
          </button>
        </form>
        <Feedback state={tamperState} />
      </Card>

      <Card
        title="Replay the last webhook"
        blurb="Takes the most recent verified Stripe event, recomputes a valid signature, and posts it again. Counts journal entries before and after. Twice is one."
      >
        <form action={replayAction}>
          <button type="submit" disabled={replaying} className="btn btn-ghost text-sm">
            {replaying ? 'Replaying…' : 'Replay it'}
          </button>
        </form>
        <Feedback state={replayState} />
      </Card>

      <Card
        title="Send an unsigned webhook"
        blurb="Posts an event with a rubbish signature. It should be rejected, and the attempt should still be recorded so a rejected delivery is auditable rather than invisible."
      >
        <form action={forgeAction}>
          <button type="submit" disabled={forging} className="btn btn-ghost text-sm">
            {forging ? 'Sending…' : 'Send a forged event'}
          </button>
        </form>
        <Feedback state={forgeState} />
      </Card>

      <Card
        title="Plant a reconciliation break"
        blurb="Books a payment against a provider reference that does not exist at Stripe — the fat-finger a real operations team makes. Then run reconciliation and watch it surface."
      >
        <form action={plantAction}>
          <button type="submit" disabled={planting} className="btn btn-ghost text-sm">
            {planting ? 'Planting…' : 'Plant one'}
          </button>
        </form>
        <Feedback state={plantState} />

        {planted.length > 0 ? (
          <div className="mt-4 pt-3 border-t rule space-y-3">
            <p className="text-xs font-semibold">Planted and not yet corrected</p>
            {planted.map((p) => (
              <form key={p.id} action={fixAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="entryId" value={p.id} />
                <span className="num text-[11px] text-[var(--ink-soft)]">{p.ref}</span>
                <button type="submit" disabled={fixing} className="btn btn-ghost text-xs">
                  Correct it with a reversal
                </button>
              </form>
            ))}
            <Feedback state={fixState} />
          </div>
        ) : null}
      </Card>

      <Card
        title="Pull Stripe out from under it"
        blurb="Forces every outbound Stripe call to fail. Binding, refunds and reconciliation all refuse cleanly instead of half-writing. Turn it back on and nothing needs replaying."
      >
        <form action={outageAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="enabled" value={outageOn ? 'off' : 'on'} />
          <button
            type="submit"
            disabled={toggling}
            className={`btn text-sm ${outageOn ? 'btn-primary' : 'btn-ghost'}`}
          >
            {toggling ? 'Switching…' : outageOn ? 'Bring Stripe back' : 'Take Stripe down'}
          </button>
          <span className={`chip ${outageOn ? 'chip-bad' : 'chip-good'}`}>
            {outageOn ? 'down' : 'up'}
          </span>
        </form>
        <Feedback state={outageState} />
      </Card>

      <Card
        title="The agent surface"
        blurb="Three read tools and one write tool that cannot post. The write tool files a proposal in the approval queue, where a human who is not the agent has to approve it."
      >
        <div className="space-y-2 text-sm">
          <p className="text-[var(--ink-soft)]">
            Descriptor and the list of operations never delegated to an agent:
          </p>
          <a href="/api/mcp" className="btn btn-ghost text-xs" target="_blank" rel="noreferrer">
            GET /api/mcp
          </a>
        </div>
      </Card>
    </div>
  );
}

function Card({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 border-b rule">
        <h2 className="font-semibold text-sm">{title}</h2>
        <p className="text-xs text-[var(--ink-soft)] mt-0.5">{blurb}</p>
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Feedback({ state }: { state: FireState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-3 text-sm text-[var(--bad)] bg-[var(--bad-soft)] rounded-md px-3 py-2">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-3 text-sm text-[var(--ink)] bg-[var(--line-soft)] rounded-md px-3 py-2 leading-relaxed">
        {state.notice}
      </p>
    );
  }
  return null;
}
