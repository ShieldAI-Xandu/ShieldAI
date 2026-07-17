# ShieldAI — NIST 800-53 & State Privacy: 12 Frameworks Reached

## Headline

**12 frameworks — 11 control-mapped, 1 AI-assisted.** The registry generates
that claim from the code, so it can't drift from what the product does.

| | Frameworks |
|---|---|
| **Control-mapped (11)** | NIST CSF, CIS v8.1, HIPAA Security, SOC 2, PCI DSS, ISO 27001, NIST 800-171, CMMC, **NIST 800-53**, FTC Safeguards, **State Privacy** |
| **AI-assisted (1)** | GDPR |
| **Not offered (2)** | HITRUST (licence-prohibited), SOC 1 (not a security framework) |

Nothing sits at `planned` anymore. `DEPTH.PLANNED` is retained — the depth
ladder is the honesty mechanism and the next framework will land there first.

## Files

- **securityChecklist.js** — 13 → 35 questions. 22 new, all `scoring: false`.
- **riskEngine.js** — imports `SCORING_CHECKLIST`, not `SECURITY_CHECKLIST`. 3 lines, load-bearing.
- **nist80053.js** (NEW, 406 lines) — 800-53 Rev 5 Low baseline, 149 controls.
- **statePrivacy.js** (NEW, ~400 lines) — 18 common obligations across ~20 state laws.
- **frameworks.js** — both registered as control-mapped; two `planned` stubs removed.
- **taskRoutes.js** — gap engine scoped to scoring questions; catalogue exposes `affectsPostureScore`.
- **nist80053.test.mjs**, **statePrivacy.test.mjs**, **riskEngine.test.mjs** (NEW).

## The thing that nearly broke silently

`riskEngine.scoreFromChecklist()` iterates the whole checklist and normalises by
total factor weight. **Adding any scoring question re-weights every historical
client's posture score** — no error, no crash, just a different number for a
customer who changed nothing. For a product whose slide 10 is "deterministic,
explainable, repeatable," that's the worst available bug: invisible, retroactive,
and it discredits the exact number insurers are asked to trust.

The fix is the `scoring: false` flag. Evidence questions are structurally
invisible to the engine.

`riskEngine.test.mjs` pins it: a fixed mid-profile scores **exactly 65
(Moderate; 66/60/60/70/68)**, and answering all 22 evidence questions at *best*
and at *worst* both leave it at 65. If that test fails, someone changed the
scoring methodology — a product decision with customer-communication
consequences, not a test to quietly update.

It also pins that all-best answers score **99, not 100** — `itManagement` and
`responseSupport` cap at 90 because "we have IT staff" isn't a perfect state.
That was my test being wrong, not the engine. Documented so nobody rounds it up.

## Checklist expansion — 22 evidence questions

Five sections: Access & Identity (4), Data Protection (4), Vendors & Third
Parties (3), Governance (6), **Privacy (5)**.

The Privacy section is what made State Privacy possible at all. Nothing in the
original 13 tells you whether a business honours a deletion request.

**Measured effect** (every question answered, vs. the old 13):

| Framework | Assessed before | After | Universe |
|---|---|---|---|
| NIST 800-53 | 86 | **149** | 149 |
| State Privacy | 6 | **18** | 18 |

## NIST 800-53 Rev 5 — Low baseline (149 controls, 18 families)

**Control IDs came from NIST's OSCAL profile, not from recall.** Extracted from
`NIST_SP-800-53_rev5_LOW-baseline_profile.json` v5.2.0, titles resolved against
NIST's published catalogue. This mattered more than usual: several widely-cited
sources say the Low baseline is **150**. It is **149** — 131 base controls plus
18 enhancements. A framework whose control list is subtly wrong is worse than
one we don't offer.

- **Low only.** Moderate (287) and High (370) are named and explicitly not
  assessed — a system at those levels needs an assessor and an SSP, and a
  self-service gap analysis there gives false comfort where it's expensive.
- **18 families, not 20.** PM and PT carry no Low-baseline controls. That's
  NIST's design, not our omission — the test asserts their absence.
- **`mappingFidelity: "family-informed"`.** 35 questions cannot distinguish
  AU-2 from AU-3. The output says so: family scores reliable, individual control
  scores indicative. Public domain, so IDs and titles are reproduced verbatim.

## State Privacy — 18 obligations, deliberately not a state list

Structurally unlike every other framework, for two reasons:

1. **It isn't one framework.** ~20 statutes that rhyme. No canonical control list
   exists because no canonical law exists.
2. **The roster changes every session.** Reputable trackers currently say 19, 20,
   23, *and* 24 — they variously count in-effect vs. enacted, and split on
   whether Florida's narrower law qualifies.

So: **obligations are assessed; the roster is dated reference data** (`asOf:
"2026-07"`) pointing at the IAPP tracker, with `countIsContested: true` and the
conflicting figures named. We say "roughly twenty" rather than pick a number to
sound authoritative.

**Applicability is never determined.** `applicabilityPrompt()` returns
`determined: false` always. Applicability turns on resident counts, revenue, and
data-sale volume — none of which a security assessment collects, all of which
carry fines. It surfaces risk signals and routes to counsel.

Notable: a business holding no consumer data is flagged `noConsumerData`, not
scored 100% — "compliant because the questions don't apply" is a lie in the
flattering direction. `legalReviewRequired: true` is set on the framework entry.

## Also fixed

- `frameworks.js` had `},SOC1_GUIDANCE];` jammed onto the closing bracket.
- `coverageSummary().marketingClaim` said "0 more on the roadmap." Clauses are
  now omitted at zero.
- `/api/tasks/gaps` would have listed 22 "improves your score by 0" items,
  burying the fixes that matter. Scoped to scoring questions; evidence gaps
  surface in the compliance workspace where they mean something.

## Verification

Eight suites green: riskEngine, soc2, pci, iso27001, nist800171, cmmc, nist80053,
statePrivacy. Posture score confirmed **65 → 65** across the change.

Four suites (`isolation`, `domain.contract`, `sandbox`, `intel.status`) fail with
`ERR_MODULE_NOT_FOUND` — **verified pre-existing** by running them against a
pristine copy of the zip. They need a running server; unrelated to this work.

## Open — the honest gap

**The other seven frameworks gained nothing from the 22 new questions.** Their
evidence mappings predate them and still point only at the original 13:

| Framework | Assessed | Universe | Unassessed |
|---|---|---|---|
| ISO 27001 | 74 | 93 | **19** |
| NIST 800-171 | 96 | 110 | 14 |
| CMMC | 96 | 110 | 14 |
| PCI DSS | 53 | 61 | 8 |
| HIPAA Security | 37 | 41 | 4 |
| SOC 2 | 32 | 33 | 1 |

Not a bug — those modules work correctly. But the checklist expansion is doing a
third of the job it could. `accessReviews`, `encryptionAtRest`, `vulnManagement`,
and `mediaDisposal` map cleanly onto real ISO and 800-171 controls that currently
report "not yet assessed" forever.

**Rewiring the seven existing frameworks to the new evidence is the highest-value
next task** — it's the difference between 12 frameworks that exist and 12 that
are deep. 800-171 matters most: it's the one facing a real assessor before the
10 November 2026 CMMC deadline.

Then: GDPR promotion from AI-assisted (deferred by choice — legal obligations
resist checklist mapping, and the Privacy intake section now makes it tractable).
