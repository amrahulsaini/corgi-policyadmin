# Status, compliance and operations

Where every requirement in `docs/BRIEF.md` landed, how production runs, and what is left.

**Live:** https://corgi-policyadmin.35-193-160-200.nip.io
**Repo:** https://github.com/amrahulsaini/corgi-policyadmin

---

## 1. Access

### Demo logins

Password for every account: `corgi-demo-2026`

| Role | Email | Why this account exists |
| --- | --- | --- |
| Staff | `dana@corgi.test` | The initiator. Issues, endorses, corrects, cancels, reconciles |
| Staff | `marcus@corgi.test` | The second approver. Maker-checker is meaningless with one login |
| Broker | `kim@meridian.test` | Meridian Risk Partners — check passed, can bind |
| Broker | `sam@harbor.test` | Harbor Point — check not passed, binding refused |
| Customer | `ops@sierrafreight.test` | Read-only portal |

Created by `scripts/seed.ts`. Rebuild from zero with `npm run seed -- --reset`.

### Test card

```
4242 4242 4242 4242   ·   any future expiry   ·   any CVC   ·   any ZIP
```

### Secrets — deliberately not in this repository

Committing a secret is an automatic fail, so none of the following appear anywhere in git:

| Secret | Where it actually lives |
| --- | --- |
| `DATABASE_URL` (with password) | `/srv/corgi/.env` on the VM, `chmod 600`, owned by the `corgiapp` nologin user |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | same file |
| `PERSONA_API_KEY`, `PERSONA_WEBHOOK_SECRET` | same file |
| `SESSION_SECRET`, `MCP_TOKEN` | same file |
| Local copies | `deploy/env.remote` and `.env.local`, both gitignored and verified with `git check-ignore` |

Every key the system needs is named in `.env.example` with no values. Only test-mode keys are used;
`lib/stripe.ts` throws at construction if handed a key starting with `sk_live`, and `lib/persona.ts`
refuses a key without `sandbox` in it.

---

## 2. How production runs

```
   Internet
      │  HTTPS
      ▼
┌─────────────────────────────────────────────┐
│ GCP VM · corgi · us-central1-a · e2-small   │
│ Debian 12 · static IP 35.193.160.200        │
│                                             │
│  Caddy :443                                 │
│   ├── automatic Let's Encrypt certificate   │
│   ├── health check → /api/health every 10s  │
│   └── readable 503 while the app restarts   │
│            │                                │
│            ▼                                │
│  Next.js :3000  (systemd unit `corgi`)      │
│   └── runs as `corgiapp`, a nologin user    │
│            │                                │
│            ▼                                │
│  PostgreSQL 15 · localhost only             │
└─────────────────────────────────────────────┘
```

**Hostname.** `corgi-policyadmin.35-193-160-200.nip.io`. `nip.io` resolves any prefix in front of an
encoded IP straight to that IP, so the host reads as a name without buying a domain, and because
`nip.io` is on the Public Suffix List, Let's Encrypt issues a genuine certificate for it.

**Region.** `us-central1` rather than the Mumbai region the rest of this GCP account uses, because
the people opening the URL are in the US and latency is part of how a demo feels.

**Postgres listens on localhost only.** Nothing but the app process can reach it.

### Deploying

```bash
bash deploy/deploy.sh
```

Roughly three minutes. It tars the working tree, ships it over `gcloud compute scp`, applies pending
migrations, builds, and restarts the service.

Deliberately **not** a `git clone` on the box — that would put a GitHub credential on a machine
exposed to the internet. The tarball keeps every credential off the server except the app's own
`.env`.

### Operating it

| Task | Command |
| --- | --- |
| Watch logs | `gcloud compute ssh corgi --zone=us-central1-a --command="sudo journalctl -u corgi -f"` |
| Restart | `sudo systemctl restart corgi` |
| Reset demo data | `npx tsx scripts/seed.ts --reset` from `/srv/corgi` |
| Prove the loop | `npx tsx scripts/verify-loop.ts` |
| Health | `curl https://corgi-policyadmin.35-193-160-200.nip.io/api/health` |

---

## 3. The ten non-negotiables

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 1 | Deployed, two roles | **Done** | Live URL, three roles |
| 2 | Double-entry, append-only, immutable | **Done** | `db/migrations/0001_ledger.sql` — triggers refuse UPDATE/DELETE/TRUNCATE |
| 3 | Two live integrations | **Done** | Stripe test mode and Persona sandbox, both real API calls and real webhooks |
| 4 | Webhooks done properly | **Done** | Signatures verified, two idempotency layers, out-of-order events park |
| 5 | The correction test | **Done** | `lib/policy/correct.ts`, verified on the deployed database |
| 6 | Approvals above a threshold | **Done** | `lib/approvals.ts` — enforced by a database constraint, not a code path |
| 7 | Reconciliation as a feature | **Done** | `lib/reconciliation.ts`, breaks screen with aging |
| 8 | Agent surface, implemented | **Done** | `/api/mcp` — three read tools, one write tool that can only propose, plus the never-list |
| 9 | Money is never a float | **Done** | `bigint` minor units, `lib/money.ts` |
| 10 | Decision log written as you go | **Done** | `docs/decisions.md`, 25+ timestamped entries, readable in the git history |

---

## 4. The domain gauntlet, item by item

| # | Requirement | Status | Implementation |
| --- | --- | --- | --- |
| 1 | Written versus earned premium | **Done** | Premium **layers**. Each change opens a layer over its own window; earned is the sum of each layer earned across that window, computed on read |
| 2 | A term is a year, not 365 days | **Done** | `anniversary()` and `dayCount()` use real calendar dates. 1 Mar 2027 → 1 Mar 2028 is 366 days; 1 Mar 2028 → 1 Mar 2029 is 365 |
| 3 | Endorsement money | **Done** | `priceEndorsement` re-rates, subtracts the standing annual, pro-rates over the **remaining** term from the **effective** date |
| 4 | The correction test | **Done** | Reversal version + negative layer + reversing entry at the original date, then a re-book at the corrected date. The reversal posts at the **original** effective date, so the polluted period comes back into line |
| 5 | Cancellation | **Done** | Pro-rata implemented; short-rate implemented at a flat 10% penalty. Refund moves through `stripe.refunds.create` |
| 6 | Claims money | **Done** | Reserve as append-only events. Four gates: claim open, payee verified, within the reserve, within the limit **in force on the loss date** |
| 7 | Commission | **Done** | Earned on **collected** premium — defended in the decision log — clawed back on returned premium |
| 8 | The broker statement | **Done** | Effective-dated, ties to account 2200 with a verdict on screen, SHA-256 fingerprint proves a closed month reproduces |
| 9 | As-of reconstruction | **Done** | `loadPolicyAsOf(policyId, asOf, knownAt)`. Date picker on the policy, on the ledger, and on the PDF |
| 10 | The rounding penny | **Done** | Every division uses `floorDiv`. Charges round down, refunds round up in magnitude — rounding always favours the policyholder; residual books to account 5900 |
| 11 | Taxes and fees are not premium | **Done** | CA surplus lines tax 3.00% and stamping fee 0.18% (refundable) plus a $25 policy fee (**not** refundable). Own accounts, own flags, effective-dated rows. Never enter the earned-premium maths |

### The core loop, verified end to end

`scripts/verify-loop.ts` run against the deployed database:

```
1. COLLECT   stripe intent → succeeded, $6,454.31 · BALANCED · chain intact
2. ENDORSE   booked 2026-12-01 $935.52 over 273/365 days
   CORRECT   to 2026-10-01 → $1,144.56, difference $209.04
             original entry still effective 2026-12-01 — untouched
3. CLAIM     payee verified · reserve $33,000 · paid $22,000 · incurred $55,000
             over-limit payment refused · third-party payee blocked
4. CANCEL    unearned $4,673.20 · tax back $149.09 · fee retained $25.00
             refund $4,822.29 · clawback $700.98
             Stripe refund re_… status succeeded
             claim still open with its reserve intact
5. STATEMENT collected $6,454.31 · commission $934.56 → TIES TO THE CENT
             re-run fingerprint identical: true
6. RECONCILE checked 3 payments, found 2 breaks

FINAL  debits $77,477.92 = credits $77,477.92 · BALANCED · chain intact
```

---

## 5. Required integrations

| Slot | Required | Status | Evidence |
| --- | --- | --- | --- |
| Premium collection | Must be live | **LIVE — Stripe test mode** | Real charges, real webhooks with verified signatures, real `stripe.refunds.create` returning `succeeded`. `livemode: false` on every object |
| Broker KYB | Must be live | **LIVE — Persona sandbox** | Real inquiries (`inq_…`), real one-time links, HMAC-verified webhooks. **See the caveat below** |
| Bank verification | Live or simulated | **Simulated, labelled** | Live Plaid sandbox when `PLAID_CLIENT_ID`/`PLAID_SECRET` are present — one env var, no code change |
| Document generation | Must work for real | **REAL** | `pdfkit`, generated from the ledger for any as-of date |
| Claim payout rail | Live or simulated | **Simulated, labelled** | Payments book to a claim payout clearing account, which is where a real rail attaches |

### The Persona caveat, stated plainly

**Persona's sandbox trial tier offers KYC and AML inquiries. There is no business-verification
product on it to call.** The broker check therefore runs live against the agency principal rather
than the entity. The integration is genuinely live — real API calls, real webhooks, real signature
verification — but it is identity verification, not a registry lookup on the business.

Production would use Middesk or Persona's KYB tier. This is said here, in the README, and in the
cut list rather than dressed up, because presenting a mock as live is the fastest way to fail.

### One thing that went wrong, and how it was found

The Persona webhook subscription existed with the right URL but its status was `disabled` at the
provider. Zero events had ever been delivered. The system did not paper over it: the broker sat at
`pending` and binding stayed refused.

It was diagnosed by querying `webhook_events` (empty for Persona), then confirmed against Persona's
own API. Two things came out of it: the subscription was enabled, and a **Check status now** button
was added that polls the provider directly. That button recovered the stuck broker without anyone
touching the database — which is the brief's own line about polling being a fallback strategy rather
than the design, demonstrated instead of claimed.

---

## 6. Live fire — the panel's own attack list

Every one of these is a button on `/staff/live-fire`.

| What they said they will do | What happens |
| --- | --- |
| Issue a policy and pay with a test card, watching the webhook and its journal entries | Bind as Kim, pay, land on `/paid` which says plainly that nothing posts from the browser returning — only from the signed webhook. The policy page shows both entries expanded into lines |
| Hand you a backdated effective-date error and watch you correct it | The correction form on the policy. Reversal at the original date, re-book at the corrected one, original untouched |
| Replay the payment webhook. Twice is one | **Replay the last webhook** — recomputes a valid signature, counts entries before and after |
| Cancel mid-term with an open claim; what happened to the refund, commission and reserve? | Refund is unearned premium, unaffected by the claim. Commission claws back on returned premium only. The reserve is untouched and the claim stays open — cancelling cover going forward does not extinguish a loss that already happened |
| The policy as it stood between two endorsements | The as-of date picker, plus the bitemporal `as known at` field on the ledger |
| Plant a mismatched payout and find it | **Plant a reconciliation break**, run reconciliation, then **correct it with a reversal**. The mistaken entry stays in the journal — that is the point |
| *(unlisted)* Pull a provider out from under it | **Take Stripe down.** Binding, refunds and reconciliation refuse cleanly rather than half-writing |
| *(unlisted)* Try to edit a money row | **Attempt UPDATE and DELETE.** Both refused by the database, then the hash chain is recomputed |

---

## 7. What is not built

### Cut deliberately — full reasoning in `docs/cut-list.md`

| Not built | Why |
| --- | --- |
| Renewals | Issuance with a prior term attached. Exercises no machinery the rest of the loop does not already exercise |
| Installment billing | One collection proves the rail; the failure case is the same webhook-consumer question |
| Public REST API | The MCP surface was the better use of the same hours, and it is a required deliverable |
| E-signature | Generation from data was the requirement; signing sits on top of a PDF that already exists |
| Second product line | The schema is product-agnostic, but one product modelled properly beats two modelled thinly |
| Customer self-service endorsements | Every endorsement lands in the same approval path regardless of where it originates |
| Break resolution workflow | Breaks surface with aging and can be corrected; assignment and notes were cut |
| Bank debit (ACH) collection | The brief mentions card **and** bank debit. Card is live; ACH would be a second Stripe payment method behind the same charge model |

### Known limits

- **Persona is KYC, not KYB** — sandbox tier limitation, not a design choice
- **Bank verification defaults to a simulator** — live Plaid is one environment variable away
- **The claim payout rail is a clearing account** — Increase or Moov attaches there without touching the claim model
- **Short rate uses a flat 10% penalty** — real tables are filed per state; the ledger expresses both bases
- **Earned premium is computed on read** — always consistent, but a nightly posting job would let the income statement stand without a derivation step

### Stretch ladder — none attempted

USDC payout, installment billing, e-signature, a second product line, broker API keys, reinsurance
cession. All were correctly below the core in priority; none were reached.

---

## 8. Submission checklist

### Into the portal

| Field | Value |
| --- | --- |
| Deployed URL | `https://corgi-policyadmin.35-193-160-200.nip.io` |
| Demo credentials | Staff `dana@corgi.test`, Broker `kim@meridian.test`, both `corgi-demo-2026`. Second staff `marcus@corgi.test` for maker-checker; second broker `sam@harbor.test` for the blocked path |
| Repo | `https://github.com/amrahulsaini/corgi-policyadmin` |
| Video | Unlisted YouTube or Loom, five minutes or less |
| Evidence | Shared folder of screenshots, or read-only sandbox dashboard access |

### Before submitting

- [ ] Invite `@AlexanderReinicke` and `@mojafa` to the repository, or make it public
- [ ] Run `npm run seed -- --reset` so the demo starts clean and Harbor Point is unverified again
- [ ] Record the five-minute video
- [ ] Capture the evidence pack (below)
- [ ] Confirm the T+24h money-moves email went to the thread

### Evidence pack — what to screenshot

**Stripe dashboard, test mode:**
1. Payments list showing succeeded charges
2. One payment's detail, with the metadata carrying `charge_id` and `policy_number`
3. **Developers → Webhooks → your endpoint → the delivery log.** This is the one they specifically
   ask for — it proves events reached the deployed system
4. The refund on the cancelled policy, showing `succeeded`

**Persona dashboard, sandbox:**
5. Inquiries list showing real `inq_…` records
6. The webhook subscription showing status `enabled` and its delivery log

**The app itself:**
7. `/staff/live-fire` after pressing *Attempt UPDATE and DELETE* — the database refusing
8. A policy page with the as-of picker set to a past date
9. `/staff/reconciliation` with a break surfaced

### Five-minute video — a running order that fits

| Time | What to show |
| --- | --- |
| 0:00–0:30 | The ledger is two tables and one door. Show `ledger_post` refusing an unbalanced entry |
| 0:30–1:30 | Bind as Kim, pay `4242…`, land on `/paid`, refresh, open the policy in the staff console and expand the journal entries |
| 1:30–2:30 | Endorse mid-term. Point at *273 of 365 days*. Send it to approvals, try to approve it as yourself, fail, approve as Marcus |
| 2:30–3:30 | Correct the effective date. Show the reversal and the re-book, and the original still sitting there unchanged |
| 3:30–4:15 | Cancel with a real Stripe refund. Show the refund in the Stripe dashboard. Note the claim is still open with its reserve |
| 4:15–5:00 | Live fire: attempt UPDATE and DELETE, replay a webhook twice, plant a break and find it |

Say the through-line once, at the start or the end: **this system cannot lie, it shows its work, and
it survives you trying.**

---

## 9. Reading order for a stranger

1. `README.md` — what it is, how to run it, integrations labelled honestly
2. `docs/BRIEF.md` — the brief, verbatim
3. **`docs/STATUS.md`** — this file
4. `docs/CODEBASE.md` — every screen, its URL, and the file behind it
5. `docs/decisions.md` — the decision log, written as the work happened
6. `docs/cut-list.md` — what was not built and why
