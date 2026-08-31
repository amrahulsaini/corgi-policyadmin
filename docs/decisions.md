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
