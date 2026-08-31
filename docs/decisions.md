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
