# Cut list

What was deliberately not built, why, and what week two looks like.

## Cut, and why

**Renewals.** The brief lists them in v1 scope. A renewal is issuance with a prior term attached and
a rate comparison — it exercises no machinery the rest of the loop does not already exercise. The
hours went into the correction path instead, which is where this domain actually hurts.

**Installment billing.** One collection proves the rail. Installments mainly add a schedule and a
dunning state machine, and "what happens when installment three fails" is the same webhook-consumer
question already answered by `payment_intent.payment_failed`.

**A public REST API.** The MCP surface is a better use of the same hours: it is a required
deliverable, it forced the read model to be explainable rather than merely queryable, and it made us
write down what an autonomous caller must never be allowed to do.

**E-signature.** Document generation from data was the requirement. Signing is a provider flow on
top of a PDF that already exists.

**A second product line.** The schema is product-agnostic — `product_code` on the policy, rating
keyed by it — but shipping only commercial general liability means the one product is modelled
properly rather than two modelled thinly.

**Customer portal beyond read-only.** The customer can see policies and pull their declarations page.
Self-service endorsement requests were cut; every endorsement here originates from staff or the agent
surface, and both land in the same approval path.

**Resolving reconciliation breaks from the breaks screen.** Breaks surface with aging and can be
corrected from the live-fire panel, which posts a proper reversal. A dedicated resolution workflow
with assignment and notes was cut.

## Known limits, stated plainly

**Persona is KYC, not KYB.** The sandbox trial tier offers identity and AML inquiries; there is no
business verification product to call. The check runs live against the agency principal. An
entity-level registry lookup — Middesk or Persona's KYB tier — is what this would use in production.

**Bank verification defaults to a simulator.** The adapter calls Plaid's sandbox when
`PLAID_CLIENT_ID` and `PLAID_SECRET` are present and falls back to a labelled simulator otherwise.
Both sit behind one interface, and the claim payout gate does not know or care which answered.

**The claim payout rail is a clearing account, not a rail.** A claim payment debits the reserve and
credits claim payout clearing. Wiring Increase or Moov would add settlement and return webhooks
against that account without touching the claim model — that is the point of booking it to a clearing
account rather than straight to cash.

**Short rate is implemented but the penalty is a flat 10%.** Real short-rate tables are filed by
state and vary by how far into the term the cancellation falls. The ledger expresses both bases; only
the table is simplified.

## Week two

1. **The claim payout rail, properly.** Increase or Moov sandbox behind the existing clearing
   account, with delayed settlement and returns. A returned payout is a reversal plus a re-book, the
   same machinery the endorsement correction already uses.
2. **Renewals**, with the prior term's loss experience visible at quote time.
3. **Middesk for real KYB**, replacing the principal-level check.
4. **Break resolution workflow** — assignment, notes, and a proposed correcting entry that lands in
   the approval queue rather than posting itself.
5. **Installment billing**, because it is what brokers actually ask for, and because failed
   installment three is a genuinely interesting state machine.
6. **A second product line** to prove the schema, most likely commercial auto, which shares the
   vehicle exposure model already in place.
7. **Daily earning job.** Earned premium is currently computed on read, which is correct and always
   consistent. A nightly job that posts the earning entry would make the income statement stand on
   its own without a derivation step.
