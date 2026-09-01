# Corgi policy administration — Track 1

Commercial general liability, from bind to cancellation, on a double-entry ledger that the database
itself refuses to let anyone edit.

**Live:** https://corgi-policyadmin.35-193-160-200.nip.io

## Demo accounts

Password for every account: `corgi-demo-2026`

| Role | Email | What it shows |
| --- | --- | --- |
| Staff | `dana@corgi.test` | issues, corrects, reconciles |
| Staff | `marcus@corgi.test` | the second approver — maker-checker needs two people |
| Broker | `sam@harbor.test` | KYB approved by a live Persona inquiry, can bind |
| Broker | `kim@meridian.test` | KYB unverified, binding refused until a check passes |
| Customer | `ops@loopwar.test` | read-only policy view and declarations page |

## Integrations — live or simulated

| Slot | Provider | Status | Evidence |
| --- | --- | --- | --- |
| Premium collection and refunds | Stripe test mode | **LIVE** | Real API calls, real webhooks arriving at the deployed URL with verified signatures, real `stripe.refunds.create`. `livemode: false` on every object. |
| Broker check | Persona sandbox | **LIVE** | Real inquiries (`inq_…`), real one-time links, HMAC-verified webhooks. Read the caveat below. |
| Bank account verification | Plaid sandbox | **SIMULATED** | Labelled simulator by default; calls the live Plaid sandbox when `PLAID_CLIENT_ID` and `PLAID_SECRET` are set. One environment variable, no code change. |
| Document generation | `pdfkit`, local | **REAL** | Declarations page and endorsement schedule generated from the ledger for any as-of date. |
| Claim payout rail | Clearing account | **SIMULATED** | Deliberate: payments book to claim payout clearing, which is where a real rail attaches. A rail is an adapter, not a schema. |

Nothing in this table is labelled live unless a real third-party sandbox is being called from the
deployed system and returning real responses.

**The Persona caveat.** Persona's sandbox trial tier offers KYC and AML inquiries — there is no
business-verification product on it to call. The broker check therefore runs live against the agency
principal rather than the entity. The integration is genuinely live; it is identity verification, not
a registry lookup on the business. Production would use Middesk or Persona's KYB tier.

## Money handling

- **USD only.** Amounts are `bigint` minor units in TypeScript and `bigint` in Postgres. Never a
  float, never a JavaScript `number`.
- **Rounding.** Every pro-rata division uses `floorDiv`. Charges floor downward, refunds floor away
  from zero. One rule, one function, and it always lands the same way: the carrier absorbs the
  residual cent as a slightly smaller charge or a slightly larger refund, so rounding favours the
  policyholder. No entry is needed to express that, because the entry is already the rounded figure
  and it still balances.
- **One state, filed properly.** California is the only state with filed rates and taxes, and the
  quote form offers no other. Rating carries factors for Texas and New York, but a state is only
  offered once its taxes and fees are on file — a rated risk with no filed tax is a risk that cannot
  be billed correctly.
- **Taxes and fees are not premium.** California surplus lines tax (3.00%) and the SLA stamping fee
  (0.18%) are refundable and credit their own liability accounts. The $25 policy fee is fully earned
  at inception and does not come back on cancellation. None of them enter the earned-premium maths.

## The ledger

Two tables and one door.

- `journal_entries` — one row per money event, carrying **both** `effective_date` (when it happened)
  and `booked_at` (when this system learned of it).
- `journal_lines` — the debits and credits, in integer minor units.

Everything goes through `ledger_post`, a `plpgsql` function that refuses an entry which does not
balance, has fewer than two lines, carries no value, or reuses a `posting_key`.

`UPDATE`, `DELETE` and `TRUNCATE` raise an exception on `journal_entries`, `journal_lines`,
`policy_versions`, `premium_layers`, `claim_events`, `premium_charges`, `charge_events` and
`refunds`. Verified against the deployed database as the `postgres` superuser:

```
update journal_lines set amount_minor = 1;
ERROR:  ledger rows are append-only: UPDATE on journal_lines is forbidden
```

Every entry also stores the hash of the entry before it plus a SHA-256 over its own canonical
content. `ledger_verify_chain()` walks the journal and reports the first link that does not match.
The trigger stops edits through the database; the chain detects anything that went around it.

No balance is stored anywhere. `ledger_balance(account, as_of, known_at)` sums the lines, and both
date arguments are optional — which is what makes "the policy as it stood on 3 May" and "what we
believed on Wednesday" the same query with different parameters.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in your own sandbox keys
npm run migrate
npm run seed                   # add --reset to rebuild from zero
npm run dev
```

Deploying to the VM is one command: `bash deploy/deploy.sh`. It ships a tarball over
`gcloud compute scp`, runs migrations, builds, and restarts — no repository credential ever lives on
the server.

## Documentation

| File | What it covers |
| --- | --- |
| `docs/BRIEF.md` | The brief as received, verbatim |
| `docs/STATUS.md` | Requirement-by-requirement compliance, how production runs, submission checklist |
| `docs/CODEBASE.md` | Every screen, its URL, and the file behind it |
| `docs/decisions.md` | The decision log, written as the work happened |
| `docs/cut-list.md` | What was not built, and why |

## Layout

```
db/migrations     schema, the posting function, the immutability triggers
lib/money.ts      minor units, floorDiv, largest-remainder allocation
lib/premium.ts    day counts, anniversaries, pro-rata, premium layers
lib/rating.ts     commercial general liability rating, every component explained
lib/tax.ts        state surcharges, refundability, effective-dated rates
lib/ledger        posting, reversal, balances, trial balance, chain verification
lib/payments      Stripe checkout, and the consumers that turn webhooks into entries
docs/decisions.md the decision log, written as the work happened
```
