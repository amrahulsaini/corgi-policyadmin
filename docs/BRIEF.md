# Track 1 — Policy administration

The brief as received, kept verbatim so that every claim in `docs/STATUS.md` can be checked against
the words that produced it.

A commercial insurance policy, from the moment it is sold to the moment it is cancelled or renewed,
including every change made along the way, every dollar collected and refunded, and the claims paid
against it.

> **Full disclosure: this track is the day job.** Corgi's own platform runs exactly this loop for
> real US commercial lines, and it is far deeper than it looks — most of our scars come from the
> money paths below. Pick it knowing your debrief panel has built every piece of this and knows
> where the bodies are buried. That cuts both ways: nothing impresses us more than someone meeting
> us in our own domain.

## The brief, as we received it

> We sell a commercial liability product through brokers. Everything after the sale lives in
> spreadsheets and a shared inbox. We need a system that takes a policy the moment it is sold and
> runs it for its whole life: issuing it, changing it mid term, renewing it, cancelling it, and
> paying claims against it.
>
> Mid term changes are called endorsements. Adding a vehicle, raising a limit, correcting an
> address. Almost every endorsement changes what the customer owes, and the difference is charged
> from the day the change takes effect, not the day someone typed it in.
>
> All financial records are immutable and append only. We are audited and nothing may ever be
> edited or deleted. Operations still need to correct back dated errors: if someone entered the
> wrong effective date three weeks ago, the corrected figure must be what appears on the customer's
> statement, and the statement must reconcile.
>
> We take premium by card and by bank debit. Refunds go back the way the money came. Brokers must
> pass a business check before they can transact, and we owe each broker a monthly statement that
> ties out to the cent. We will not build card processing or identity checks ourselves — use
> providers.
>
> Users need to see their documents. Users need to approve endorsements above a threshold. Users
> need to reconcile the month.
>
> We want the first broker live in six weeks. In scope for v1: policy issuance, endorsements,
> renewals, cancellation with refunds, claims intake, claims reserving and payment, broker
> commission accounting, document generation, a broker portal, a customer portal, a staff console,
> and a public API.

## What you are actually building

The core loop, working end to end on a deployed URL:

**issue a policy → collect real (test-mode) premium → endorse it mid-term with a pro-rated charge →
cancel it with a real refund → open, reserve and pay a claim → produce a broker statement that ties
to the ledger.**

Everything else — which portals, which screens, renewals, the public API — is your scoping call.
Defend it in the decision log.

## Required integrations

| Slot | Requirement | Suggested sandbox | Live or simulated |
| --- | --- | --- | --- |
| Premium collection | Collect premium on issuance and endorsement. Refund unearned premium on cancellation through the provider's actual refund API — not a ledger entry that pretends. | Stripe test mode or GoCardless sandbox | Must be live |
| Broker KYB | A broker cannot bind business until their entity passes a check. Show the pending and failed states, not just the happy one. | Persona KYB, Middesk, Sumsub | Must be live |
| Bank account verification | Verify the account you pay claims and refunds into actually belongs to the claimant. | Plaid sandbox (auth + identity) | Live or simulated |
| Document generation | A declarations page and endorsement schedule generated from data. "Print the policy as it stood on May 3" must work. | Any PDF library; Documenso for e-sign stretch | Must work for real |
| Claim payout rail | Pay a claim out on a rail with delayed settlement and possible returns. | Increase, Moov, Modern Treasury sandboxes; Circle or Bridge testnet USDC as the stretch | Live or simulated |

## The domain gauntlet

These are the mechanics of the vertical. We grade whether they live in your schema and state
machines. If a term is new, that is the point — getting up to speed on an unfamiliar domain in hours
is the actual test.

1. **Written versus earned premium.** Premium is earned pro-rata daily across the term; the unearned
   remainder is a liability you owe back. Every money question in insurance starts here.
2. **A policy term is one year, not 365 days.** Anniversaries and leap years. A term written on
   1 March 2028 ends 1 March 2029, and your pro-rata daily rate knows it.
3. **Endorsement money.** The premium delta is priced over the *remaining* term and charged from the
   effective date, never the entry date. Backdating changes the maths, not just a label.
4. **The correction test.** An endorsement was entered three weeks ago with the wrong effective date.
   Fix it with reversal entries plus a re-book at the correct date. Original rows untouched,
   statement shows the corrected figure, month still reconciles. We run this live.
5. **Cancellation.** Pro-rata versus short-rate refund — know the difference, implement one, and make
   the ledger capable of expressing the other. The refund is unearned premium, and it moves on the
   real rail.
6. **Claims money.** A reserve is an estimate, adjustable, every adjustment an append-only event.
   Payments draw the reserve down. Incurred = paid + reserve. Nothing pays past the limit.
7. **Commission.** A rate per broker. Decide whether commission is earned on written or on collected
   premium — defend the choice — and claw it back when premium refunds.
8. **The broker statement.** Monthly: premium collected, commission earned and clawed back, net due.
   It ties to the ledger to the cent, and re-running it for a closed month produces the same document
   forever.
9. **As-of reconstruction.** Show the policy — coverage, limits, premium, documents — as it stood on
   any past date. This falls out free if your model is event-shaped, and is nearly impossible if it
   is not.
10. **The rounding penny.** Pro-rata always leaves one. Decide who eats it, make it deterministic,
    write it down.
11. **Taxes and fees are not premium.** US commercial insurance collects state premium tax and flat
    fees alongside the premium — rates vary by state and change on effective dates. They ride the
    same payment but never pollute the premium figure: the customer's charge includes them, the
    earned-premium maths excludes them, and the cancellation logic knows exactly which pieces come
    back. Model at least one state properly rather than a global percentage.

## Live fire

What we will do in your debrief, so nothing is a surprise:

- Issue a policy through your UI and pay with a test card, watching the webhook land and the journal
  entries it creates.
- Hand you a backdated effective-date error and watch you correct it.
- Replay the payment webhook from the provider dashboard. Twice is one.
- Cancel a policy mid-term with an open claim, and ask what happened to the refund, the commission,
  and the reserve.
- Ask for the policy as it stood between two endorsements.
- Plant a mismatched payout and ask your reconciliation screen to find it.

## A build order that works

Not mandatory, but candidates who succeed tend to: stand up the ledger and policy issuance first,
wire the live payment rail before lunch on day one, get the endorsement pro-rata maths correct
second, and leave portals and polish for day two. The T+24h checkpoint expects money moving — plan
backwards from that.

## Stretch ladder

When the core is standing, in rough order of signal:

- Claim payout in USDC on a testnet, ledgered like any other rail.
- Installment billing with a monthly surcharge, and what happens when installment three fails.
- E-signature on the policy documents with a real provider flow.
- A second product line sharing the schema — proves the model is not a one-liability wonder.
- Broker API keys with rate limits and an audit trail.
- A reinsurance cession note: who else is on the risk, and what the ledger owes them.

## What we grade hardest here

The ledger's honesty under correction, the endorsement maths, and whether refunds and clawbacks move
real (test-mode) money instead of being rows that claim they did.
