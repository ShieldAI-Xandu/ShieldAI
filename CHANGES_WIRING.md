# ShieldAI — Frameworks Wired: Agent Evidence, Scoping Intake, Mastermind

## The finding that reframed this session

**`frameworks.js` was imported by nothing.** Zero callers. All 11 control-mapped
modules — PCI's 61 sub-requirements, ISO's 93 Annex A controls, 800-53's 149,
roughly 3,000 lines built over several sessions — were unreachable from the
running product. The live workspace ran on `complianceFrameworks.js`: 6
frameworks, ~10 hand-written requirements each.

Then it got worse. **Seven route modules were never registered in `server.js`:**

| Module | What was dark |
|---|---|
| `complianceRoutes.js` | The entire compliance workspace API |
| `taskRoutes.js` | Tasks, gap analysis, fix simulation |
| `evidenceRoutes.js` | Evidence / audit readiness |
| `portfolioRoutes.js` | Analyst portfolio — **a prior changelog says this shipped** |
| `brandingRoutes.js` | White-label branding |
| `complianceTracking.js` | Compliance tracking |
| `customFrameworks.js` | Custom framework CRUD |

`App.jsx` calls **none** of those endpoints either — so this isn't a lost
registration block. These were built, tested, and never connected on either side.

The "12 frameworks" claim was true of the codebase and false of the product.
That's the one direction that matters.

**On `portfolioRoutes.js`:** its changelog says access control was *"verified via
runtime smoke test."* That cannot have been true through HTTP — the route was
never registered. Module-level tests pass while the feature is unreachable.
**Worth re-verifying anything else marked "verified" the same way.**

## What's now live (proven over HTTP, not just unit-tested)

```
GET /api/compliance/frameworks        -> 200, 12 frameworks
GET /api/compliance/overview          -> 200, deep results per framework
GET /api/compliance/framework/iso-27001 -> 200, 93 real Annex A controls
GET /api/tasks/controls               -> 200, 35 (13 scoring / 22 evidence)
```

**624 controls now reachable where the legacy path had 57.**

| Framework | Was | Now |
|---|---|---|
| ISO 27001 | 10 | **93** |
| NIST 800-53 | — | **149** |
| NIST 800-171 / CMMC | 10 | **110** each |
| PCI DSS | 8 | **61** (7 when SAQ-scoped) |
| HIPAA | 9 | **41** |
| SOC 2 | 10 | **33** |
| State Privacy | — | **18** |
| FTC Safeguards | — | **9** |

## Files

**New:** `complianceBridge.js`, `agentEvidence.js`, `frameworkIntake.js`,
`complianceBridge.test.mjs`
**Changed:** `server.js` (registers compliance + task routes),
`complianceRoutes.js`, `mastermindRoutes.js` (both repointed to the bridge)

## The merge — deep modules drive the workspace

`complianceBridge.js` keeps every legacy signature (`evaluateFramework`,
`evaluateAllFrameworks`, `remediationContext`, `getFrameworkDef`,
`listFrameworkIds`) so routes and UI didn't change, and delegates to the deep
modules. The old 6 became views onto real assessments rather than parallel
shallow copies.

Each module groups differently — HIPAA `groups[].standards[].specs[]`, SOC 2
`categories[].series[].criteria[]`, PCI `requirements[].subs[]`, ISO
`themes[].controls[]`, FTC's elements *are* the controls. `normaliseGroups()` and
`controlsOf()` flatten all five shapes. Field aliases too: FTC uses
`evidenceFrom` not `evidence`; PCI subs use `number` not `id`.

**Legacy ids still work.** `hipaa` → `hipaa-security`, `iso-27001` → `iso27001`,
both directions. Old bookmarks and stored records don't break.

**Percentages are over `assessed`, never `total`.** An unanswered questionnaire
reads `null`, not "0% compliant" — a very different, and much less alarming,
statement.

## Agent evidence — three rules, decided deliberately

Per your calls: **agent informs, questionnaire decides, disputes go to a human.**

1. **The agent never overwrites an answer.** It sees endpoints; a control is
   organisational. "Is data encrypted at rest" covers the file server, the S3
   bucket, and the backups — not just the three laptops running our collector.
2. **Disagreement is surfaced, not resolved.** Client says "fully encrypted,"
   agent sees BitLocker off on 2 of 5 → `disputed`, routed to an analyst.
   Auto-resolving toward the agent punishes one unmanaged laptop; toward the
   client makes telemetry decorative. **A dispute is often the most valuable
   output of the assessment** — it's the gap between what a business believes
   and what's true.
3. **Coverage is always stated.** Host counts and unanimity, always. A
   confirmation across 2 of 40 hosts is not a confirmation.

Mapped: `disk_encryption`→`encryptionAtRest`, `firewall`/`av_realtime`→`endpoint`,
`patches`→`vulnManagement`, `local_admins`→`privilegedAccess`. Each carries its
own `limits` text. `screen_lock` is marked `informationalOnly` — it's weak
evidence for access reviews and says so rather than pretending.

`evaluateWithAgent()` annotates; it does not mutate. Tested: agent data changes
**zero** control statuses.

**The agent needed no changes.** It already observes what the frameworks need,
and it stays permanently read-only — nothing here sends it instructions.

## Framework scoping intake

Six frameworks now have questionnaires. The deep modules **already accepted**
scoping options — `suggestSaq()` has been sitting in `pciDss.js` with no caller —
so every PCI assessment ran unscoped.

**Measured effect, live over HTTP:**
- **PCI: 61 → 7 sub-requirements** for a hosted-payment-page merchant, SAQ A
  correctly identified. Knowing you're SAQ A is worth more to a small merchant
  than the gap analysis that follows.
- **ISO: 93 → 74** for a remote, non-developing business, with 19 justified
  exclusions retained (an auditor asks what you excluded and why).

Design rules held: scoping decides *which* controls apply, the checklist decides
*how well* they're met; a suggestion is never a determination (the acquirer
decides your SAQ, the contracting officer decides your CMMC level); every intake
is skippable with `defaultsFor()` stating what an unscoped run assumed.

SOC 2 **force-includes Security** even if deselected — "SOC 2 without Security"
isn't a thing. ISO exclusions are keyed by real control ID (`A.7.1`…`A.7.14`),
derived from the catalogue, not theme names. **A.8.4 (access to source code) is
deliberately not excluded** for a non-developing business — they may still hold a
contractor's repo, and excluding it on that answer would be a guess.

## Mastermind — read-only, boundary intact

Repointed to the bridge, so `check_compliance` now answers from 93 real ISO
controls with citations instead of 10 summaries. Three tools added:

- **`explain_control`** — what a control asks, its citation, current status, and
  what answer satisfies it. Tells you if a control was *scoped out* and why.
- **`check_agent_evidence`** — confirmations and disputes, with the boundary
  restated in the tool output so Mastermind frames disputes as findings rather
  than accusations.
- **`check_framework_scoping`** — whether intake is complete and what was
  assumed if skipped.

**Verified: zero mutating verbs across all tools.** Answers, recommends,
explains. No actions.

## Verification

Nine suites green: riskEngine, soc2, pci, iso27001, nist800171, cmmc, nist80053,
statePrivacy, complianceBridge. Server boots; endpoints confirmed live via real
HTTP against a registered account with a stored assessment.

Four suites (`isolation`, `sandbox`, `intel.status`, `domain.contract`) still fail
with `ERR_MODULE_NOT_FOUND` — **verified pre-existing** against a pristine copy.

## Open

**Five route modules remain orphaned:** `evidenceRoutes`, `portfolioRoutes`,
`brandingRoutes`, `complianceTracking`, `customFrameworks`. I registered only
compliance and tasks — the two this work depends on. The rest need their
signatures checked and, more importantly, **frontend wiring**: `App.jsx` calls
none of these endpoints. Registering a route the UI never calls just moves the
orphan.

**Mastermind's `check_evidence` and `get_branding` tools call features whose
routes are still dark.** They read `db.data` directly so they won't crash, but
the client-facing half doesn't exist.

**The seven pre-existing frameworks still don't use the 22 new evidence
questions** — ISO assesses 74 of 93, PCI 53 of 61, 800-171 96 of 110. Their
mappings predate them. That rewiring is the highest-value remaining task and is
what closes the gap between "12 frameworks that exist" and "12 that survive
diligence."
