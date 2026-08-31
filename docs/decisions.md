# Decision log

Timestamps are UTC. Entries are appended as decisions are made, not reconstructed afterwards.

---

## T+00:20 — Track 1, Next.js on Postgres

Picked Track 1 (policy administration). Next.js on Vercel with Neon Postgres, because the binding
constraint on day one is a public HTTPS URL that a Stripe webhook can actually reach. A framework
that deploys in one push is worth more here than any runtime nicety.

## T+00:35 — The ledger is a database function, not application code

`ledger_post` is a `plpgsql` function. Nothing in the application inserts into `journal_entries` or
`journal_lines` directly. The function refuses an entry that does not balance, refuses one with
fewer than two lines, and refuses one with no value.

The reason is that "every entry balances" should not be a property of the code path that happened to
write it. It should be a property of the database. There is exactly one door into the ledger and it
is locked from the inside.

## T+00:40 — Append-only is enforced by the database, not by convention

`UPDATE`, `DELETE` and `TRUNCATE` on `journal_entries` and `journal_lines` raise an exception from a
statement-level trigger. The same triggers are on `policy_versions`, `premium_layers` and
`claim_events`, because those are the rows that a correction would otherwise be tempted to edit.

A README promising immutability is worth nothing. A connection with full privileges still cannot
edit a money row here.

## T+00:45 — Hash chain over the journal

Every entry stores the hash of the previous entry and a SHA-256 over its own canonical content:
sequence number, effective date, booked timestamp, event type, posting key, and every line as
`account:side:amount`. `ledger_verify_chain()` walks the whole journal and reports the first entry
whose links do not match.

First attempt computed the hash after inserting the lines, which meant temporarily disabling the
immutability trigger to write it back. That is a loophole wearing a hat. Replaced it: the sequence
number is drawn from a sequence before the insert, so the hash is computed from the input JSON and
written in the same statement that creates the row. The trigger is never disabled.

## T+00:50 — Bitemporal from the first table

`effective_date` is when a money event happened in the world. `booked_at` is when this system learned
about it. Both are on every journal entry and every policy version.

This is the one decision that cannot be retrofitted. The backdated correction test and the
"print the policy as it stood on May 3" requirement are both a `WHERE` clause once these two columns
exist, and both are near-impossible without them.

## T+00:55 — Money is `bigint` minor units, everywhere

USD cents as `bigint` in TypeScript and `bigint` in Postgres. Not `number`, even though JavaScript
integers are exact to 2^53 and no insurance amount comes close. `bigint` removes the argument
entirely, and it makes an accidental `0.1 + 0.2` a type error rather than a rounding surprise.

Serialised as strings at API boundaries.

## T+01:00 — The rounding rule: floor everything, the carrier eats the penny

Every pro-rata division uses `floorDiv`. Charges are positive and floor downward; refunds are
negative and floor away from zero, which makes them larger. One function, one rule, and it always
lands the same way: **rounding favours the policyholder, and the residual cent is booked to account
5900, Rounding difference.**

Earned premium floors for the same reason — a floored earned figure leaves unearned premium slightly
overstated, which is the conservative direction for a liability we owe back.

## T+01:05 — California modelled properly rather than a global percentage

`tax_rates` carries state, kind, rate or flat amount, refundability, and an effective-from date, so a
rate change is a new row rather than an edit. California is seeded with surplus lines tax at 3.00%,
the SLA stamping fee at 0.18%, and a flat $25 policy fee.

The policy fee is marked non-refundable: it is fully earned at inception and does not come back on
cancellation. The two taxes are refundable and return in proportion to the returned premium. Taxes
and fees ride the same charge as premium but never enter the earned-premium maths — they credit
their own liability accounts at issuance.

## T+01:10 — Premium is modelled as layers, not as one annual figure

Issuance opens a layer spanning the whole term. An endorsement opens a layer spanning effective date
to term end, holding only the delta. Earned premium at any date is the sum of each layer earned
across its own window.

The alternative — recomputing a single annual premium and re-deriving the earning curve — makes a
backdated endorsement rewrite history. Layers make it additive, which is the only shape that
survives an append-only rule.

## T+01:40 — Self-hosted on a GCP VM rather than Vercel

Switched the deployment target to a Debian 12 VM in us-central1, fronted by Caddy with automatic
Let's Encrypt certificates on `35-193-160-200.nip.io`, with Postgres on the same box.

Vercel would have been faster to stand up. Two things decided against it. The nightly reconciliation
run and the daily premium-earning job want a persistent process and real cron; the free tier caps
cron at once daily with a ten-second ceiling. And a cold start during a live demo is a bad look for a
system whose whole claim is that it stays calm under pressure.

us-central1 rather than the Mumbai region the rest of this account uses, because the people opening
the URL are in the US and latency is part of how a demo feels.

Certificate issuance verified before any application code was deployed, so an SSL problem could never
be discovered at hour forty.

## T+02:10 — Deployed, with the immutability claim verified against the running database

`https://corgi-policyadmin.35-193-160-200.nip.io` is live on Caddy with a Let's Encrypt certificate.
`nip.io` accepts an arbitrary prefix in front of the encoded IP, so the host reads as a name rather
than an address without buying a domain.

Deployment is a tarball over `gcloud compute scp` rather than a git clone on the box, so no repository
credential ever lives on the server. `deploy/deploy.sh` runs migrations, builds, and restarts in one
command.

Verified on the deployed database, not on a laptop:

- `ledger_post` accepted a balanced entry and returned its id
- `update journal_lines set amount_minor = 1` raised `ledger rows are append-only`
- `delete from journal_entries` raised the same
- an entry with debits 100 and credits 99 was refused by the posting function
- `ledger_verify_chain()` returned the single entry as intact

All four ran as the `postgres` superuser. Full database privileges do not buy you the ability to edit
a money row here.

## T+02:15 — TypeScript target raised to ES2022

`create-next-app` defaults to ES2017, which rejects `bigint` literals outright. Raising the target was
the cheaper fix than giving up `bigint` for money, which was never on the table.

## T+02:50 — Rating and taxes are data, not constants in a handler

`lib/rating.ts` prices commercial general liability from base charge, limit at 42 bps per thousand,
per-vehicle and per-square-foot exposure charges, a deductible credit, a filed state factor, and a
filed minimum premium. Every component is returned with the basis it was computed from, so a quote
can be explained line by line rather than asserted.

The same discipline applies to `lib/tax.ts`. Flat fees are computed first, percentage rates apply to
premium plus flat fees, and each surcharge carries its own ledger account and its own refundability
flag. Changing California's stamping fee is a new row in `tax_rates`, not a redeploy.

## T+02:55 — Two staff accounts in the seed, deliberately

Maker-checker cannot be demonstrated with one staff login. The seed creates Dana and Marcus so the
initiator and the approver are genuinely different people, and it creates two brokers — one KYB
approved, one unverified — so the blocked path has somewhere to be shown.

## T+03:00 — postgres.js transaction typing

`sql.begin` hands the callback a `TransactionSql`, which is not assignable to `Sql`. Introduced a `Db`
union so every service function accepts either a pool or a transaction, which is what lets issuance,
endorsement and correction all compose inside one atomic unit later. `bigint` parameters are passed as
strings with an explicit `::bigint` cast rather than relying on driver coercion.

## T+03:40 — Stripe wired, and the webhook endpoint created through the API

The dashboard's new Workbench buries webhook creation, so the endpoint was created with a `POST` to
`/v1/webhook_endpoints`, which returns the signing secret directly. Subscribed to
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
`charge.dispute.created` and `checkout.session.completed`. `livemode: false` confirmed on the
endpoint object.

`lib/stripe.ts` throws at construction if the key starts with `sk_live`. A live key cannot start this
application even by accident.

## T+03:50 — Two layers of idempotency, not one

`webhook_events` has a unique index on `(provider, provider_event_id)`, so a replayed delivery is
recognised before any work happens and returns `{ duplicate: true }`.

Underneath that, every posting carries a `posting_key` that is unique in `journal_entries`, so even a
consumer bug that got past the first guard cannot post the same money twice. `ledger_post` returns
the existing entry id rather than raising, which makes the whole path safely re-runnable.

The second layer is not redundant. The first is keyed on the provider's event identity, the second on
the business meaning of the entry — a different provider event that means the same money movement is
still stopped.

## T+03:55 — Money moved end to end on a real rail

Bound `CGL-CA-100002` for a 2026-08-31 inception. Premium $6,230.40, California surcharges $223.91,
total $6,454.31. Created and confirmed a Stripe test payment intent for exactly that amount.

Stripe delivered `payment_intent.succeeded` to the deployed endpoint, the signature verified, and the
consumer posted `premium.collected`. Resulting balances:

```
1000 Cash at processor          645431
2000 Unearned premium           623040
2100 Surplus lines tax payable   18766
2110 Stamping fee payable         1125
2200 Commission payable          93456
4100 Policy fee income            2500
5000 Commission expense          93456
```

Premium receivable nets to zero — debited at issuance, cleared on collection. Surplus lines tax is
3.00% of premium plus policy fee, floored. The stamping fee is 0.18% of the same base, floored.
Commission is 15% of collected premium, which is the choice recorded below.

Replayed the same event twice with a valid recomputed signature: both returned `duplicate: true`,
the entry count stayed at two and cash did not move. A forged signature was rejected with a 400 and
recorded with `signature_valid = false`, so rejected deliveries are still auditable.

This satisfies the T+24h checkpoint at roughly T+4h.

## T+04:00 — Commission is earned on collected premium

Booked when cash arrives, not when the policy is written. Two reasons. It matches when the money
actually moved, which makes the broker statement tie to cash rather than to intent. And clawback
becomes symmetric: if premium refunds, commission reverses against the same account it was credited
to, with no receivable to chase from a broker who was paid on business that never funded.

The cost is that a bound-but-unpaid policy shows no commission expense, which understates what the
broker will eventually earn. That is the honest position, and the broker statement shows written and
collected separately so the gap is visible rather than hidden.

## T+04:05 — postgres.js needs its own JSON helper

Passing `JSON.stringify(x)` with a `::jsonb` cast lands in Postgres as a JSON *scalar*, not an
object, so `jsonb_array_length` failed on the posting lines. The driver's `sql.json()` helper is the
correct path. Fixed in every place a jsonb parameter is passed, not only the one that broke — the
others would have silently stored strings where objects were expected.

The verified webhook body is stored as `sql.json(JSON.parse(raw))`, so what is kept is exactly what
Stripe sent rather than a re-serialised copy.

## T+05:10 — Endorsements price the delta over the remaining term

`priceEndorsement` re-rates the whole risk at the new exposure set, subtracts the standing annual
premium to get an annual delta, then pro-rates that delta from the effective date to term end. The
resulting amount opens its own premium layer over exactly that window.

Flat fees are excluded from an endorsement's surcharges. The $25 California policy fee is charged
once at inception and does not repeat every time a vehicle is added; only the percentage taxes apply
to additional premium. `surchargesFor` takes an `includeFlatFees` flag for exactly this.

## T+05:20 — The correction is a reversal plus a re-book, proved on the deployed database

`correctEndorsementDate` writes five things inside one transaction: a reversal version pointing at
the original, a negative premium layer mirroring the original layer's window, a reversing journal
entry at the original effective date, a re-book version at the corrected date, and a fresh journal
entry priced from the corrected date.

Nothing is edited. Verified end to end against the deployed database:

```
endorsed at the WRONG date 2026-11-01
  annual delta   $755.20
  pro-rata       $626.91 over 303 of 365 days

corrected to 2026-09-15
  corrected      $724.16 over 350 of 365 days
  difference      $97.25

#3  2026-11-01  endorsement.booked            $646.83
#4  2026-11-01  endorsement.booked.reversed   $646.83   (reversal)
#5  2026-09-15  endorsement.booked            $747.18

original entry still reads effective 2026-11-01
chain intact, debits $15,884.02 = credits $15,884.02
```

The reversal is posted at the *original* effective date, not at today's. That matters: the reversal
has to undo the wrong figure in the period the wrong figure landed in, or the month it polluted
never comes back into line.

## T+05:30 — Maker-checker, enforced twice

Endorsements above `APPROVAL_THRESHOLD_MINOR` do not post. They land in `approvals` as a payload, and
a different staff user has to execute them.

Enforced in three places on purpose: the database has a check constraint that rejects
`decided_by = requested_by`, `decideApproval` raises `SelfApprovalError` before touching the ledger,
and the approvals screen refuses to render decision buttons on your own request. The constraint is
the one that actually matters; the other two exist so the person gets a sentence rather than a
stack trace.

## T+05:45 — Persona wired live, and the KYB reality

Persona's sandbox trial tier offers KYC + AML inquiries, not a business verification product. Rather
than pretend otherwise, the broker check is a live Persona inquiry against the agency principal, and
the entity-level registry lookup is out of scope for this build. The README says so plainly.

The integration is genuinely live: `createInquiry` and `generate-one-time-link` are real API calls
returning real inquiry ids, and the webhook verifies Persona's `t=,v1=` HMAC the same way Stripe's
is verified. Confirmed end to end on the deployed system:

```
before:        Harbor Point Insurance Services → unverified
inquiry:       inq_AE1xLTzYTNYZLEjbSy6U51mWEPFNvb   (live sandbox)
after start:   pending
webhook:       processed — broker moved to approved
after:         approved
```

`kyb_events` is append-only, so the pending → approved history survives. `brokers.kyb_status` is a
mirror of provider truth for querying, not the record itself.

An unmatched inquiry parks rather than throwing: the webhook for an inquiry with no broker behind it
returned `parked` with a readable note and a 200, because a provider retrying forever against a 500
is worse than a queued event someone can look at.

## T+05:50 — When the provider is unreachable, binding stays closed

`startVerification` failing surfaces the provider error to the broker and leaves KYB where it was.
The bind gate is a positive check for `approved`, so any failure mode — provider down, timeout,
malformed response — degrades to refusing to bind rather than to allowing it.

## T+06:30 — Cancellation, and what a negative premium layer buys

Cancellation opens a layer over `[cancellation date, term end]` holding the negative of the unearned
premium. At the cancellation date that layer has earned nothing, so earned premium is unchanged. At
term end it is fully earned, exactly offsetting the remaining positive layers. Earned premium
therefore freezes at the cancellation date and written premium drops immediately, without a single
row being edited.

Refund composition follows the tax model. Unearned premium comes back. The surplus lines tax and
stamping fee come back in proportion to the returned premium. The $25 policy fee does not — it is
marked non-refundable in `tax_rates` and is fully earned at inception. Commission claws back on the
returned premium at the broker's rate, debiting commission payable against the same account it was
credited to.

Short rate is implemented at a flat 10% penalty, retained as earned premium. The ledger expresses
both bases; only the filed table is simplified, and the cut list says so.

The refund moves through `stripe.refunds.create` against the original payment intent, with an
idempotency key on the policy. Verified: `re_3UAYsL…` returned `succeeded` for 482229 minor units.

## T+06:40 — Cancelling with an open claim

Live fire asks what happens to the refund, the commission and the reserve when a policy with an open
claim is cancelled. The answer this system gives:

- the refund is unearned premium and is unaffected by the claim — the customer paid for cover they
  will not use, and a loss that already happened does not change that
- commission claws back on the returned premium only, not on premium already earned
- the reserve is untouched and the claim stays open

Verified in `scripts/verify-loop.ts`: after cancellation the claim still reports open with its
reserve intact. Cancelling cover going forward does not extinguish a loss that already occurred.

## T+06:50 — Claims: the gates are in the service, not the screen

`payClaim` refuses four ways: the claim must be open, the payee bank account must have verified, the
payment cannot exceed the standing reserve, and paid plus the payment cannot exceed the occurrence
limit in force **on the loss date** — not the current limit, which matters once an endorsement has
raised it mid-term.

A payment debits the reserve and credits claim payout clearing rather than cash. That clearing
account is where a real rail attaches, and it means adding Increase or Moov later changes an adapter
rather than the claim model.

## T+07:00 — Bank verification compares the payee against the insured

The requirement is to verify the account you pay into actually belongs to the claimant. The first
implementation checked the payee name against a name the simulator invented, which verified nothing.
Rewritten: the account belongs to the named insured, and the check is whether the payee agrees with
that party. Typing a third-party payee fails and blocks payouts, which is the fraud this control
exists to catch.

Plaid sandbox is called when its keys are present; otherwise a labelled simulator answers behind the
same interface. The payout gate cannot tell which responded, which is the test of whether the
abstraction is real.

## T+07:10 — The broker statement is derived, and reproducible

The statement filters journal entries by `effective_date` inside the month and by `booked_at <= the
close moment`. Re-running a closed month with the same close moment reproduces byte-identical
figures, which the script asserts by comparing a SHA-256 fingerprint over the lines and totals.

It ties by construction: the net due is compared against the commission payable movement on account
2200 for the same broker and period, and the screen shows a "ties to the ledger" verdict rather than
asking anyone to take it on trust.

Note that a clawback effective in January does not appear in the August statement. That is correct —
the statement is effective-dated, not booking-dated — and it is why written and collected are shown
separately.

## T+07:20 — Reconciliation compares provider truth to derived truth

`runReconciliation` pulls succeeded payment intents from Stripe for the period and diffs them against
`premium.collected` entries by `source_ref`. Three break kinds: at the provider and not here, here
and not at the provider, and amounts disagreeing. Breaks carry aging.

The first real run found a genuine orphan — a payment intent from an earlier smoke test whose policy
had since been dropped by a database reset. That is exactly the class of break this is for, and it
surfaced without being planted.

## T+07:30 — The MCP surface, and the never-list

Three read tools and one write tool at `/api/mcp`, JSON-RPC over HTTP, bearer token. `GET` returns
the descriptor and the never-list without authentication, so the boundary is legible.

`propose_endorsement` prices the change and files it in the human approval queue. It cannot post. The
response says so in its first line, and the approval it creates is subject to the same database
constraint as everyone else's — the agent can never be its own approver.

`explain_balance` returns every line summing to an account with a running total and the provider
reference behind each. It was written for an agent and turned out to be the answer to "where does
this number come from", which is the question a person actually asks.

## T+07:40 — Live fire as a screen, not a promise

`/staff/live-fire` runs the panel's own scripted attacks as buttons: attempt UPDATE and DELETE on the
journal, replay the last webhook with a recomputed valid signature while counting entries before and
after, send a forged signature, plant a reconciliation break and correct it with a reversal, and
force Stripe down.

The outage switch is a database flag checked by every outbound Stripe path. With it on, binding,
refunds and reconciliation refuse cleanly rather than half-writing, and turning it back off requires
no replay because nothing was left in flight. Degrading toward refusing to transact is the safe
direction for an insurer.

Planting a break posts a real premium receipt against a provider reference that does not exist. It
cannot be deleted afterwards — correcting it is a reversal, which is the honest demonstration of the
whole thesis.

## T+09:10 — Bug: the deductible credit never applied

Found while explaining the quote form. `DEDUCTIBLE_CREDIT_BPS` was keyed in cents (`'250000'`) but
looked up in dollars (`(deductibleMinor / 100n).toString()` gives `'2500'`). The lookup never
matched, `?? 0` swallowed it, and the deductible dropdown silently changed nothing about the price.

Two changes. The keys are now dollars so they match the lookup, and the `?? 0` fallback is gone — an
unrecognised deductible now throws rather than quietly pricing as though no credit were filed. A
rating engine that cannot find a filed factor should refuse to quote, not guess.

This is exactly the class of bug the `basis` string on every rating component exists to catch: the
number was plausible, the total was internally consistent, and nothing failed. What gave it away was
recomputing the quote by hand and getting a different answer to the one the system produced.

## T+09:40 — Adding an insured at bind time, and checking the brief before building it

The quote form offered a dropdown of two seeded insureds, which reads as a demo rather than a system.
Before building the alternative I re-read the brief: it never asks for customer onboarding. The v1
scope lists a customer *portal*, not customer creation, and the core loop starts at issuance. The
dropdown was compliant.

Built it anyway, small: the select carries an extra option for a business not on file, which reveals
legal name, contact email and risk state. An unrecognised state is refused by name rather than
silently priced, because `rate()` throws for a state with no filed factor and the broker deserves to
hear that in the form rather than as a failure after binding.

Two details worth noting. The legal name is matched case-insensitively against existing customers, so
binding twice for the same business does not create a duplicate. And the entity suffix strip that
derives a short display name is anchored to the end of the string with word boundaries — an earlier
version stripped `co` from anywhere, which would have turned "Corgi" into "rgi".
