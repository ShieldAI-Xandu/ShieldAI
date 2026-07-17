# ShieldAI — Gap Closed: Live Workspace, Agent Conflicts, Zero Orphans

## Headline

**Zero orphaned routes.** All 14 route modules registered. The compliance
workspace reads the deterministic engine over HTTP. Agent telemetry populates
frameworks with a client-facing decision point when it disagrees with the
questionnaire. **+187 controls newly assessable** after rewiring five frameworks
to the evidence questions.

## The frontend was emptier than the orphan audit suggested

`App.jsx` (9,114 lines) called **exactly two endpoints**: login and register.
Everything else rendered from whatever the assessment response returned.
`ComplianceSection` displayed `results.compliance.frameworks` — prose the AI
wrote during program generation — while 624 computed, cited controls sat unused
on the server.

So the gap wasn't "routes exist but aren't registered." It was that the client
had **never seen the deterministic engine's output at all**.

## What's live now (verified over HTTP)

```
GET  /api/compliance/overview          -> 12 frameworks, posture 65
GET  /api/compliance/framework/:id     -> 93 ISO controls, 1 open decision
GET  /api/compliance/intake/pci-dss    -> 3 conditional questions
POST /api/compliance/intake/pci-dss    -> scope 61 -> 7, SAQ A
GET  /api/compliance/conflicts         -> 1 conflict, 4 valid answers
POST /api/compliance/conflicts/resolve -> reason enforced, answer updated
GET  /api/analyst/portfolio            -> ["client1@t.com"] only
```

**New:** `src/ComplianceWorkspace.jsx` — overview, control walkthrough, scoping
intake, conflict queue. Wired into `App.jsx`'s section router. Build passes.

Three rules the UI enforces: `null` renders as "—" not "0%" (not assessed ≠
failed); both sources show and the questionnaire decides; depth is labelled next
to the framework name.

## Agent conflicts — the decision point you asked for

Per your spec: **both populate, client decides.**

On any control the agent can speak to, `sources` now carries both values —
`questionnaire` (`decides: true`) and `agent` (`decides: false`) — plus `agree`.
When they disagree, `decision` offers three options:

| Option | Effect |
|---|---|
| **update-answer** | Agent's right — answer changes, everything re-scores |
| **fix-the-gap** | Answer is the goal — task opened, conflict stays open until telemetry agrees |
| **out-of-scope** | Hosts aren't representative — **written reason required**, an auditor reads it |

**Deduped by control.** One BitLocker disagreement touches 3 ISO controls but
asks the client **once** (`affectsCount: 3`). Asking 3 times — or 40 across all
frameworks — would be worse than not detecting it.

Verified end-to-end through the real agent path (enroll token → enroll → report):
client claims full-disk encryption, agent finds 1 pass / 1 fail across 2 hosts →
conflict raised → reason enforced on out-of-scope (400) → update-answer accepted
→ conflict clears. Posture correctly unmoved (evidence questions don't score).

Re-resolved conflicts that reappear show `previouslyResolved` rather than
presenting as new — "you said you'd fix it, the machines still disagree" is a
real signal.

## The blocker this exposed, and fixing it

The ISO conflict test returned **0 openDecisions** while the conflicts endpoint
found 1. Not a bridge bug — **ISO only referenced the original 13 evidence IDs**.
A.8.24 (Use of cryptography) had *no evidence at all*. Agent telemetry about disk
encryption had no ISO control to attach to.

This was the "seven frameworks ignore the 22 new questions" gap, now blocking a
feature. Rewired five frameworks — 37 ISO controls, 43 in 800-171, 25 PCI subs,
12 HIPAA specs, 13 SOC 2 criteria:

| Framework | Old 13 | All 35 | Universe | Gain |
|---|---|---|---|---|
| NIST 800-53 | 86 | 149 | 149 | **+63** |
| NIST 800-171 | 72 | 104 | 110 | **+32** |
| CMMC | 72 | 104 | 110 | **+32** (inherited) |
| ISO 27001 | 65 | 80 | 93 | **+15** |
| State Privacy | 6 | 18 | 18 | **+12** |
| HIPAA Security | 29 | 41 | 41 | **+12** (100%) |
| PCI DSS | 48 | 59 | 61 | **+11** |
| SOC 2 | 23 | 33 | 33 | **+10** (100%) |

**+187 total.** Every framework suite still passes — the mappings changed, the
guarantees didn't.

## Zero orphans

Registered all seven remaining modules: compliance, tasks, evidence, portfolio,
branding, tracking, custom frameworks.

**On `portfolioRoutes`:** its changelog recorded access control as *"verified via
runtime smoke test"* while the route was unregistered — that test cannot have
gone through HTTP. Now that it's reachable, **analyst isolation is verified for
real**:

```
portfolio (analyst) -> ["client1@t.com"]   — client2 absent
compliance?clientId=client2 -> 403          — correctly refused
compliance?clientId=client1 -> 200          — correctly allowed
```

Your hard boundary holds. It's now a claim backed by an HTTP test rather than a
module call.

## Verification

Nine suites green: riskEngine, soc2, pci, iso27001, nist800171, cmmc, nist80053,
statePrivacy, complianceBridge. Vite build clean. SPA still serves; API not
shadowed by the fallback.

`isolation` / `sandbox` / `intel.status` / `domain.contract` still fail with
`ERR_MODULE_NOT_FOUND` — **pre-existing**, confirmed against a pristine zip.

## Open

**The UI only covers compliance.** Tasks, evidence, portfolio, branding, and
tracking now have live endpoints and **no frontend calling them**. `App.jsx`
still calls two endpoints plus the workspace. Registering a route the UI never
calls just relocates the orphan — the same pattern that produced this session's
findings.

**`ComplianceSection` is dead code**, marked but not deleted, pending a decision
on the AI-generated program output.

**Mastermind's `check_evidence` and `get_branding`** now have reachable routes,
but their client-facing UI doesn't exist.

**Suggested next:** the analyst portfolio UI. It's the highest-value remaining
frontend — the endpoint is live, isolation is proven, and it's what an analyst
opens first. After that, tasks/gaps, which turns computed findings into work.
