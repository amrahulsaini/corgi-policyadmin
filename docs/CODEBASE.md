# Codebase guide

Every screen, every URL, the file behind it, and what is still missing.

**Live:** https://corgi-policyadmin.35-193-160-200.nip.io
**Stack:** Next.js 16 (App Router) · TypeScript · PostgreSQL 15 · Tailwind v4 · Caddy · Debian 12 on GCP
**Money:** USD only, `bigint` minor units end to end

---

## 1. How the whole thing is shaped

```
Browser
   │
   ▼
Caddy  ── TLS, health checks, graceful 503 when the app restarts
   │
   ▼
Next.js (systemd service on :3000)
   │
   ├── app/            screens and HTTP endpoints
   ├── lib/            all domain logic — nothing business-y lives in a page
   │
   ▼
PostgreSQL
   ├── ledger_post()          the only door into the journal
   ├── ledger_balance()       every balance, derived on read
   ├── ledger_verify_chain()  hash chain integrity
   └── immutability triggers  UPDATE / DELETE / TRUNCATE all refused
```

The rule the whole layout follows: **a page never contains domain logic.** Pages read from `lib/`
and render. Server actions validate input, call one `lib/` function, and turn the result into a
sentence. Every money decision is in `lib/`, testable without a browser.

---

## 2. Three roles, one app

| Role | Login | What they can reach |
| --- | --- | --- |
| Staff | `dana@corgi.test` · `marcus@corgi.test` | Everything: issue, endorse, correct, cancel, claims, approvals, ledger, reconciliation, live fire |
| Broker | `kim@meridian.test` (cleared) · `sam@harbor.test` (blocked) | Their own book, quote and bind, their statement |
| Customer | `ops@sierrafreight.test` | Their policies, read-only |

Password for all: `corgi-demo-2026`

Role is enforced in `app/(app)/layout.tsx` via `requireUser()`, then per page with
`requireRole('staff')`. A broker who types a staff URL is redirected to their own landing page, not
shown an error.

---

## 3. Every screen

### Public

#### `/login`
**Code:** `app/login/page.tsx` · `form.tsx` · `actions.ts`
Split-screen sign in with demo credentials printed on the page. bcrypt hash comparison, a signed
JWT (`jose`, HS256) in an httpOnly cookie, 12-hour expiry. `lib/auth.ts` holds `signIn`,
`currentUser`, `requireUser`, `requireRole`.

#### `/`
**Code:** `app/page.tsx`
Redirects to the right landing page for whoever is signed in, or `/login`.

---

### Staff console

#### `/staff` — Overview
**Code:** `app/(app)/staff/page.tsx`
Four counters, then the two things that matter: **ledger integrity** (the hash chain recomputed
across every entry on each page load, not cached) and the **trial balance** with a live
`balanced / out of balance` verdict.

#### `/staff/policies` — Policy list
**Code:** `app/(app)/staff/policies/page.tsx`
Written premium (sum of layers) against collected premium (what the processor actually settled).
Unpaid shows amber. That gap is the first thing an insurance person looks at.

#### `/staff/policies/[id]` — Policy detail · **the centrepiece**
**Code:** `app/(app)/staff/policies/[id]/page.tsx` and six sibling files
Reads through `lib/policy/view.ts`. Eight sections:

1. **As-of picker** (`as-of.tsx`) — pick any date in the term; earned premium, limits and exposures
   recompute. No snapshot is stored.
2. **Figures** — written, earned with day count, unearned, limit and deductible.
3. **Premium layers** — each layer with its own window and what it has earned at your chosen date.
4. **Version history** — effective date and booked date side by side.
5. **Endorse** (`endorse-form.tsx` → `actions.ts:endorse`) — prices the delta over the remaining
   term; above threshold it goes to approvals instead of posting.
6. **Correct** (`correct-form.tsx` → `actions.ts:correct`) — reversal plus re-book.
7. **Cancel** (`cancel-form.tsx` → `actions.ts:cancel`) — pro-rata or short-rate, real Stripe refund.
8. **Claims** (`claim-form.tsx` → `actions.ts:fileClaim`) — opens a claim and runs the payee bank check.
9. **Documents** — declarations page PDF for whatever as-of date is selected.
10. **Journal entries** — every entry that touched this policy, expanded into debit and credit lines.

#### `/staff/claims` and `/staff/claims/[id]`
**Code:** `app/(app)/staff/claims/page.tsx`, `[id]/page.tsx`, `claim-actions.tsx`, `[id]/actions.ts`
Reserve, paid, incurred and limit remaining. Detail page adjusts the reserve, issues payments, and
re-runs the bank check. Full append-only event history at the bottom.

#### `/staff/approvals` — Maker-checker
**Code:** `app/(app)/staff/approvals/page.tsx` · `decision-form.tsx` · `actions.ts` → `lib/approvals.ts`
Anything above `APPROVAL_THRESHOLD_MINOR` waits here. Your own requests render a refusal instead of
buttons. Enforced in three places, listed in §6.

#### `/staff/ledger`
**Code:** `app/(app)/staff/ledger/page.tsx` → `lib/ledger/report.ts`
Trial balance plus the last 100 entries. Two date inputs: **effective on or before** (the ordinary
as-at) and **as known at** (the bitemporal one — rebuilds balances as the system understood them at
that moment, before a later correction was learned).

#### `/staff/reconciliation`
**Code:** `app/(app)/staff/reconciliation/page.tsx` · `run-form.tsx` · `actions.ts` → `lib/reconciliation.ts`
Pulls succeeded payment intents from Stripe for a period and diffs them against `premium.collected`
entries. Three break kinds, each with aging: *at the provider not here*, *here not at the provider*,
*amounts disagree*.

#### `/staff/brokers`
**Code:** `app/(app)/staff/brokers/page.tsx`
Each agency with EIN, commission rate, commission payable summed from the ledger, and its KYB state
with a plain sentence about what that permits.

#### `/staff/live-fire` — **the panel that hands them the gun**
**Code:** `app/(app)/staff/live-fire/page.tsx` · `fire-panel.tsx` · `actions.ts`
The scripted attacks as buttons:

| Button | What it does |
| --- | --- |
| Attempt UPDATE and DELETE | Runs both against the journal. Both refused by the database, then the chain is recomputed. |
| Replay the last webhook | Recomputes a valid signature, posts it again, counts entries before and after. |
| Send a forged event | Rejected, and still recorded with `signature_valid = false`. |
| Plant a reconciliation break | Books a payment against a reference Stripe has never seen. |
| Correct the planted break | Posts a reversal. The mistaken entry stays — that is the point. |
| Take Stripe down | Every outbound Stripe path refuses cleanly rather than half-writing. |

---

### Broker portal

| URL | Code | What it does |
| --- | --- | --- |
| `/broker` | `app/(app)/broker/page.tsx` · `kyb-button.tsx` · `actions.ts` | KYB status, quote button live or dead, start verification, and a **Check status now** polling fallback while pending |
| `/broker/new` | `app/(app)/broker/new/page.tsx` · `form.tsx` · `actions.ts` | Quote and bind. One transaction: rate, write the policy and version, open the layer, post the entry, create the Stripe checkout |
| `/broker/policies` | `app/(app)/broker/policies/page.tsx` | Their book: written vs collected vs commission |
| `/broker/statements` | `app/(app)/broker/statements/page.tsx` → `lib/statements.ts` | Monthly statement with a ties-to-the-ledger verdict and a reproducibility fingerprint |

### Customer portal

| URL | Code | What it does |
| --- | --- | --- |
| `/portal` | `app/(app)/portal/page.tsx` | Read-only policy list |
| `/paid` | `app/(app)/paid/page.tsx` | Where Stripe returns you. Says plainly that nothing posts from the browser coming back — only from the signed webhook |

---

## 4. HTTP endpoints

| Endpoint | Code | Notes |
| --- | --- | --- |
| `GET /api/health` | `app/api/health/route.ts` | Database reachability. Caddy health-checks this |
| `POST /api/webhooks/stripe` | `app/api/webhooks/stripe/route.ts` | Signature verified, idempotent, parks what it cannot match |
| `POST /api/webhooks/persona` | `app/api/webhooks/persona/route.ts` | Same shape, `t=,v1=` HMAC |
| `GET /api/documents/declarations/[policyId]?asOf=` | `app/api/documents/declarations/[policyId]/route.ts` | PDF generated from the ledger, role-checked |
| `GET /api/mcp` | `app/api/mcp/route.ts` | Descriptor plus the never-list, no auth needed |
| `POST /api/mcp` | same | JSON-RPC. Bearer token. `initialize`, `tools/list`, `tools/call` |

---

## 5. The domain library — `lib/`

### Money and time

| File | What lives there |
| --- | --- |
| `lib/money.ts` | `Minor` = `bigint` cents. `floorDiv`, `ceilDiv`, `rateOf`, `allocate` (largest-remainder), `format`. **One rounding rule: everything floors, so charges round down and refunds round up in magnitude — rounding always favours the policyholder, and the residual cent books to account 5900.** |
| `lib/premium.ts` | Day counts, `anniversary` (real leap years), premium **layers**, `layerEarnedAsOf`, `proRataDelta`, `shortRateFactor` |

### The ledger

| File | What lives there |
| --- | --- |
| `lib/ledger/accounts.ts` | The chart of accounts as constants |
| `lib/ledger/post.ts` | `post`, `reverse`, `balance`, and the `debit`/`credit` helpers. Everything goes through the `ledger_post` database function |
| `lib/ledger/report.ts` | `trialBalance` and `chainStatus`, both bitemporal |

### Policy lifecycle

| File | What lives there |
| --- | --- |
| `lib/rating.ts` | CGL rating: base charge, 42 bps per thousand of limit, per-vehicle and per-sq-ft exposure, deductible credit, filed state factor, minimum premium. Every component returns the basis it came from |
| `lib/tax.ts` | State surcharges with refundability flags and effective-dated rates. `includeFlatFees: false` for endorsements, so the $25 policy fee is charged once |
| `lib/policy/issue.ts` | KYB gate, rate, surcharges, policy, version, layer, journal entry — one transaction |
| `lib/policy/endorse.ts` | `priceEndorsement` and `applyEndorsement`. The delta is priced over the **remaining** term from the **effective** date |
| `lib/policy/correct.ts` | The correction test. Reversal version + negative layer + reversing entry at the original date, then a re-book version + layer + entry at the corrected date |
| `lib/policy/cancel.ts` | `quoteCancellation` and `cancelPolicy`. Negative layer, tax returned proportionally, policy fee retained, commission clawback, real `stripe.refunds.create` |
| `lib/policy/view.ts` | `loadPolicyAsOf` — the as-of reconstruction every screen and the PDF reads through |

### Everything else

| File | What lives there |
| --- | --- |
| `lib/claims.ts` | Open, adjust reserve, pay. Four independent gates: claim open, payee verified, within reserve, within the limit **in force on the loss date** |
| `lib/approvals.ts` | Maker-checker. `SelfApprovalError`, and the executor that runs an approved endorsement |
| `lib/statements.ts` | Broker statement, effective-dated, with a SHA-256 fingerprint proving reproducibility |
| `lib/reconciliation.ts` | The Stripe diff and the breaks |
| `lib/documents/dec-page.ts` | Declarations page and endorsement schedule via `pdfkit`, generated from the ledger for any as-of date |
| `lib/bank/verify.ts` | Payee bank check. Live Plaid sandbox when its keys are present, labelled simulator otherwise, one interface either way |
| `lib/persona.ts` · `lib/kyb.ts` | Persona inquiries, one-time links, HMAC verification, and `refreshFromProvider` as the polling fallback |
| `lib/stripe.ts` | The client. **Throws at construction if the key starts with `sk_live`** |
| `lib/ops.ts` | The outage flag and `ProviderUnavailable`, checked by every outbound Stripe path |
| `lib/auth.ts` | Sessions and role guards |
| `lib/db/` | Connection, migration runner, the `Db` union so services accept a pool or a transaction |

---

## 6. The database — `db/migrations/`

| Migration | Contents |
| --- | --- |
| `0001_ledger.sql` | `journal_entries`, `journal_lines`, `ledger_post`, `ledger_balance`, `ledger_verify_chain`, and the immutability triggers |
| `0002_accounts.sql` | The chart of accounts |
| `0003_domain.sql` | Users, brokers, customers, policies, versions, premium layers, claims, approvals, webhooks, reconciliation, documents, tax rates |
| `0004_sequences.sql` | Policy and claim numbering |
| `0005_payments.sql` | Charges, charge events, refunds |
| `0006_kyb.sql` | Append-only KYB history |
| `0007_ops.sql` | Operational flags |

### The two tables everything hangs off

```sql
journal_entries (
  seq, effective_date, booked_at, event_type, memo,
  source, source_ref, posting_key UNIQUE,
  reverses_entry_id, corrects_entry_id,
  prev_hash, hash
)
journal_lines (entry_id, line_no, account_code, side, amount_minor)
```

`effective_date` is when it happened in the world. `booked_at` is when this system learned of it.
**That pair is the one decision that cannot be retrofitted** — the correction test and "print the
policy as it stood on 3 May" are both a `WHERE` clause once it exists.

### Why nothing can be edited

```sql
create trigger journal_entries_no_update before update on journal_entries
  for each statement execute function ledger_immutable();
```

The same triggers guard `journal_lines`, `policy_versions`, `premium_layers`, `claim_events`,
`premium_charges`, `charge_events`, `refunds` and `kyb_events`. Verified as the `postgres`
superuser on the deployed database:

```
update journal_lines set amount_minor = 1;
ERROR:  ledger rows are append-only: UPDATE on journal_lines is forbidden
```

### Why nothing unbalanced can get in

`ledger_post` is the only door. It refuses an entry that does not balance, one with fewer than two
lines, one with no value, and it returns the existing entry for a repeated `posting_key` rather than
posting twice.

### Maker-checker, enforced three times

1. `constraint approver_is_not_initiator check (decided_by is null or decided_by <> requested_by)`
2. `decideApproval` raises `SelfApprovalError` before touching the ledger
3. The screen renders a refusal instead of buttons

The constraint is the one that matters. The other two exist so a person gets a sentence rather than
a stack trace.

---

## 7. Deployment — `deploy/`

| File | Purpose |
| --- | --- |
| `provision.sh` | One-time: swap, Node 22, PostgreSQL 15, Caddy, database role |
| `deploy.sh` | Run locally. Tars the repo, ships it over `gcloud compute scp`, migrates, builds, restarts |
| `remote-deploy.sh` | Runs on the box |
| `Caddyfile` | TLS on `nip.io`, health check, a readable 503 during restarts |
| `corgi.service` | systemd unit, runs as a `nologin` system user |

Deployment ships a tarball rather than cloning the repo, so **no repository credential ever lives on
the server**. `.env` is `chmod 600` and owned by the app user.

---

## 8. Scripts — `scripts/`

| Command | What it does |
| --- | --- |
| `npm run migrate` | Apply pending migrations |
| `npm run seed -- --reset` | Drop everything, re-migrate, create demo users and brokers |
| `npx tsx scripts/demo-bind.ts` | Bind one demo policy and return a checkout URL |
| `npx tsx scripts/verify-loop.ts` | **The whole core loop end to end**, printing the trial balance and chain status at every step |
| `npx tsx scripts/verify-correction.ts` | The backdated-correction test in isolation |
| `npx tsx scripts/verify-kyb.ts` | The KYB loop against live Persona |
| `npx tsx scripts/poll-kyb.ts` | Polling fallback for a missed webhook |

---

## 9. Integrations — live or simulated

| Slot | Provider | Status | Evidence |
| --- | --- | --- | --- |
| Premium collection and refunds | Stripe test mode | **LIVE** | Real API calls, real webhooks with verified signatures, real `stripe.refunds.create`. `livemode: false` on every object |
| Broker check | Persona sandbox | **LIVE** | Real inquiries (`inq_…`), real one-time links, HMAC-verified webhooks |
| Bank account verification | Plaid sandbox | **SIMULATED** by default | Live when `PLAID_CLIENT_ID` and `PLAID_SECRET` are set — one env var, no code change |
| Document generation | `pdfkit`, local | **REAL** | Generated from the ledger for any as-of date |
| Claim payout rail | Clearing account | **SIMULATED** | Deliberate. A rail is an adapter, not a schema |

**Persona is KYC, not KYB.** The sandbox trial tier has no business-verification product to call, so
the check runs live against the agency principal. An entity-level registry lookup — Middesk, or
Persona's KYB tier — is what production would use. Stated here and in the cut list rather than
dressed up.

---

## 10. What is done

- [x] Append-only double-entry ledger, enforced by the database
- [x] Hash chain with an integrity check
- [x] Bitemporal from the first table
- [x] `bigint` minor units, one documented rounding rule
- [x] Rating from data, with every component explained
- [x] California taxes and fees modelled properly, with refundability
- [x] Policy issuance behind a KYB gate
- [x] Live Stripe collection, signature-verified and idempotent
- [x] Endorsements priced over the remaining term from the effective date
- [x] **The correction test** — reversal plus re-book, originals untouched
- [x] Cancellation pro-rata and short-rate, with a real Stripe refund
- [x] Commission on collected premium, with clawback
- [x] Claims: reserve, adjust, pay, four gates, limit in force on the loss date
- [x] Payee bank verification gating payouts
- [x] Broker statement that ties to the cent and reproduces forever
- [x] Reconciliation with three break kinds and aging
- [x] Declarations page PDF for any past date
- [x] Maker-checker enforced three ways
- [x] MCP surface: three read tools, one write tool that can only propose, plus the never-list
- [x] Live fire panel
- [x] Graceful degradation when the provider is down
- [x] Decision log, cut list, seed script, `.env.example`

## 11. What is remaining

### Cut deliberately — reasoning in `docs/cut-list.md`

| Not built | Why |
| --- | --- |
| Renewals | Issuance with a prior term attached. Exercises no machinery the rest of the loop does not |
| Installment billing | One collection proves the rail; the failure case is the same webhook question |
| Public REST API | The MCP surface was the better use of the same hours |
| E-signature | Generation from data was the requirement; signing sits on top of a PDF that exists |
| Second product line | Schema is product-agnostic; one product modelled properly beats two modelled thinly |
| Customer self-service endorsements | Every endorsement lands in the same approval path regardless of origin |
| Break resolution workflow | Breaks surface with aging and can be corrected; assignment and notes were cut |

### Known limits, stated plainly

- **Persona is KYC, not KYB** — sandbox tier limitation, not a design choice
- **Bank verification defaults to a simulator** — live Plaid is one env var away
- **The claim payout rail is a clearing account** — wiring Increase or Moov attaches there without touching the claim model
- **Short rate uses a flat 10% penalty** — real tables are filed by state; the ledger expresses both bases
- **Earned premium is computed on read** — always consistent, but a nightly posting job would let the income statement stand alone

### Week two, in order

1. The claim payout rail properly, with settlement and returns
2. Renewals, with prior-term loss experience at quote time
3. Middesk for real entity-level KYB
4. Break resolution workflow feeding the approval queue
5. Installment billing, including the failed third instalment
6. A second product line — commercial auto shares the vehicle exposure model
7. Daily earning job

---

## 12. Running it locally

```bash
npm install
cp .env.example .env.local     # your own sandbox keys
npm run migrate
npm run seed -- --reset
npm run dev
```

Deploy with `bash deploy/deploy.sh`.

Every key the system needs is documented in `.env.example`. No secret is committed; `.env*` and
`deploy/env.remote` are both gitignored, and `git check-ignore` was used to confirm it rather than
assumed.
