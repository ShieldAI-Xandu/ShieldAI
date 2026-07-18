# ShieldAI — Analyst Console: Fake Data Removed, Real Portfolio Wired

## The finding

**The analyst console rendered 143 lines of hardcoded fake clients.**

`const clients = SAMPLE_CLIENTS` — "Meridian Dental Group," posture 53, $1,800
MRR, invented phishing alerts, fabricated review queues. This drove the
**Portfolio Command Center**: the page an analyst lands on. All six KPI tiles —
including **Monthly Recurring Revenue** and **Average Posture** — were computed
from that array.

Real client data was already being fetched (`/api/analyst/clients`) and rendered
only in a secondary "My Clients" tab.

This is a different category from the orphaned routes. Dead code is invisible.
This was **live code presenting invented security and revenue data as a
dashboard** — and it contradicts the project's first principle directly: *never
ship fake security data*.

There was more of it than the array:

| Location | What it faked |
|---|---|
| `SAMPLE_CLIENTS` (143 lines) | Entire client roster, posture, MRR, alerts |
| "Weekly Program Health" | `Patch compliance: posture>50?78:34` — and MFA adoption, backup health, same pattern |
| "Compliance Progress" | An invented `target`, then "On track for certification window" measured against it |
| `pColor(null)` | Returned **red** — unscored clients would render as critical |
| `deriveStatus()` | Fell through to `"on_track"` when posture was null — **green for a client never scored** |

The `deriveStatus` one is the worst of them. A green badge against a client we
know nothing about tells a human to look away. That's the one thing a triage
view must never do.

## A correction to my earlier report

I told you `App.jsx` calls only two endpoints. **That was wrong.** It calls at
least seven — I missed template-literal calls (`` `${API_BASE}/api/...` ``)
because my grep only matched quoted strings. The frontend was better wired than
I reported; the problem was narrower and different than I described.

## What changed

### Backend — `portfolioRoutes.js`

- **`latestPosture()` now falls back to the assessment.** It read only
  `db.data.programs`, so a client who completed the full assessment but never
  generated a program showed `posture: null`. The answers were in
  `db.data.assessments` the whole time; nothing asked the engine. Uses
  `computePostureScore` — the same engine the client's own dashboard uses, so
  analyst and client cannot disagree.
- **`deriveStatus()` returns `"unknown"`** rather than `"on_track"` when there's
  no posture. Sorted **above** `on_track`, because a client we've never scored is
  a gap in coverage, not a success.
- **Conflicts drive triage.** `conflictCount()` per client; any conflict forces
  `needs_review`. Agent telemetry contradicting a client's answer makes every
  framework built on that answer suspect — that outranks a merely mediocre score.
- **New fields, real or explicitly null:** `industry`, `employees`, `history`,
  `alerts`, `reviewQueue`, `compliancePct` (computed across all frameworks,
  weakest first), `postureSource`, `hasAssessment`, `conflicts`. And `mrr: null`
  — no billing integration exists, and `0` would claim the client pays nothing.

### Frontend — `src/App.jsx`

- `SAMPLE_CLIENTS` **deleted**. Console reads `/api/analyst/portfolio`.
- KPI tiles honest: **MRR renders "—"** until billing is wired. **Avg Posture**
  averages only scored clients and says `"N of M scored"`. "High Alerts" replaced
  with **Conflicts**, which is what an analyst can act on.
- "Weekly Program Health" → **Program Health**, from real data: agent health,
  compliance readiness, posture. No answer → "not assessed", not a number.
- "Compliance Progress" → **Compliance Readiness**: real per-framework
  percentages and gap counts, weakest first. No invented target, no
  certification claim.
- `pColor(null)` → neutral, not red.
- `unknown` added to `statusMeta`; every client field access null-guarded.
- Loading / error / empty states added — the console never needed them when the
  data was always there and always cheerful.

### New — `src/AnalystPortfolio.jsx`

Standalone portfolio component (triage list, client detail, review decisions,
sparkline, embedded ComplianceWorkspace). Not yet routed — the existing console
was the better place to fix. Available if the console is ever replaced.

## Verified end-to-end

Two assigned clients + one unassigned, through the real agent path:

```
portfolio -> 200 | 2 clients (triage order)
  scored     status=needs_review  posture=65   conflicts=1  mrr=null  compliance=47%
  unscored   status=unknown       posture=null conflicts=0  mrr=null  compliance=null
  other@t.com visible? false
```

Every rule holds: the conflict outranks a decent posture; the unscored client is
`unknown`, not green; no invented MRR; isolation intact.

Nine suites green. Vite build clean. **Zero fabricated data executing** — the
only `posture>50?` matches left are inside a comment documenting what was
removed.

## The second finding: the frontend had its own copies of everything

Grepping for other hardcoded arrays — because the demo-data habit rarely lives in
one file — turned up two more, and one of them silently undid two sessions of
work.

### `SECURITY_CHECKLIST` — a frozen copy of the 13 questions

`App.jsx` had **its own hardcoded checklist**, frozen at the original 13 scoring
questions. The backend has 35.

The 22 evidence questions — access reviews, encryption, vendor diligence, media
disposal, physical security, privacy rights — **were never asked**. They're what
made ISO's cryptography controls assessable, what let State Privacy exist, what
the agent corroborates against. The backend could score them. Nobody collected
them.

Measured, through a real client journey (register → fetch checklist → answer →
submit → read compliance):

```
Client answers all 35  ->  597 of 624 controls assessed
Old hardcoded 13       ->  410 of 624
                           the 22 questions add 187 assessed controls
```

That +187 was theoretical until now. `useSecurityChecklist()` fetches
`/api/tasks/controls`; the static array is fallback only.

**Evidence questions are optional.** The gate is the 13 scoring questions —
posture is normalised across them and a gap would reweight the rest. The engine
already reports an unanswered evidence question as "not yet assessed" rather than
assuming anything, so a partial set gives a partial assessment, which is honest.
Requiring all 35 would turn a 13-question intake into a wall, and an abandoned
assessment scores nothing at all. Sections are labelled *"optional — doesn't
change your posture score, but makes more compliance controls assessable"*.

### `COMPLIANCE_FRAMEWORKS` — a stale list of 7

The client's framework picker was hardcoded to 7. The backend serves 12. NIST
800-53, 800-171, CMMC, FTC Safeguards, and State Privacy were all built,
registered, tested — and **unreachable at the one place a client selects them**.

`useFrameworkCatalog()` fetches the live list. `/api/compliance/frameworks` also
now returns `depth` and a real control count (it previously read
`f.requirements.length` off the back-compat object, whose array is always empty,
so every framework reported 0). The picker shows **"93 controls"** or **"AI gap
analysis"** — so a client choosing GDPR knows what they're getting before they
pick it, not after.

## The pattern

Three sessions, three variants of one habit:

| Session | Found | Shape |
|---|---|---|
| 1 | `frameworks.js` imported by nothing | Built, never connected |
| 2 | 7 route modules never registered | Built, never connected |
| 3 | `SAMPLE_CLIENTS`, frontend checklist, frontend framework list | Built, then **shadowed by a local copy** |

The third is the dangerous one. An orphan is inert — it does nothing and misleads
nobody. A duplicated catalogue is worse: it works, it looks right, and it goes
stale silently every time the backend ships. Two sessions of framework work
produced +187 assessable controls that no client could reach, because a 13-item
array in `App.jsx` was what they actually saw.

**Both fixes follow the same shape**: fetch the live source, keep the static copy
as an explicitly-labelled fallback, never as the default.

## Verification

Nine suites green. Vite build clean. Verified over real HTTP:

```
GET /api/tasks/controls          -> 35 questions (13 scoring / 22 evidence)
GET /api/compliance/frameworks   -> 12 with depth + real control counts
GET /api/analyst/portfolio       -> real clients, honest nulls, isolation intact
Full client journey              -> 597 of 624 controls assessed
```

`isolation` / `sandbox` / `intel.status` / `domain.contract` still fail with
`ERR_MODULE_NOT_FOUND` — pre-existing, confirmed against a pristine zip.

## Open

**`AnalystPortfolio.jsx` is unrouted.** I built it before finding that the
existing console was the better place to fix. Either route it or delete it — an
unused component is how orphans start.

**Tasks, evidence, and branding still have no UI** despite live endpoints.

**Worth auditing the remaining screens for the same duplication pattern.** I
swept for top-level `const X = [...]` arrays and found these three. Data
duplicated inside a component body wouldn't have matched that grep.


---

# Addendum — Demo Data Restored (and a bug it exposed)

## The gap

Deleting `SAMPLE_CLIENTS` removed fake data from the **production** analyst
console, which was right. But the **demo** is a separate, legitimate thing:
`seedDemo.js` seeds a real analyst, a real client, and a real assignment into
`demo-db.json`, with the same isolation rules as production. "Meridian Dental
Group" belongs there. What I deleted was a *frontend copy* of it that had escaped
into the live product.

The demo had its own problem: **it seeded only the original 13 answers.** So a
demo — the thing you show investors — would have rendered 410 of 624 controls
assessed, an empty Privacy section, and **no agent conflicts**, which is the
differentiator.

## Fixed

All three demo companies now carry all 35 answers, profiled to their maturity:

| Company | Posture | Assessed | Weakest |
|---|---|---|---|
| Meridian Dental Group | 61 Moderate | **597/624** | SOC 2 42% (5 gaps) |
| Lakeside Financial Advisors | 99 Strong | **597/624** | State Privacy 97% |
| Apex Manufacturing | 32 At Risk | **597/624** | SOC 2 3% (32 gaps) |

Validated: **105 seeded answers, 0 invalid, all 35 questions covered.** A typo
would have silently dropped an answer.

The profiles are deliberately uneven. Apex has weak IT but **good physical
security** — a factory controls access even when its network doesn't. Lakeside is
mature but has **no password manager** and an unenforced retention policy. Real
businesses are uneven; a demo where every answer tracks the posture score reads
as generated.

**Agent conflicts demo correctly:** Meridian and Lakeside claim encryption, so an
unencrypted host raises a conflict. Apex admits "some systems only" — no conflict,
because there's nothing to dispute. That's the honest outcome, and it shows the
feature isn't just firing on everything.

## The bug the demo exposed

Apex answered *"None — we're B2B and hold no consumer data"* and **State Privacy
scored it 0% with 18 gaps.**

`statePrivacy.js` already set `noConsumerData: true` and already refused to
determine applicability — I built that flag last session and then didn't act on
it. Scoring 0% asserts they fail 18 consumer-privacy obligations, when the truth
is those laws may not reach them at all and we explicitly decline to decide that.
It's the same "unknown ≠ failure" error as `deriveStatus` returning `on_track`,
pointed the other way.

Now: `coveragePct: null` with a reason the UI prints — including the two real
cautions (several states cover some B2B contact data; California explicitly
covers employee data).

`complianceBridge.js` gained a **module veto**: when a module returns
`coveragePct: null` despite controls having scored, the bridge suppresses its own
percentage and surfaces `pctSuppressedReason` rather than recomputing the 0% the
module just declined to state. A B2C client with the same weak answers still
scores 0% — that one is a real finding.

The demo data was the only reason this surfaced. No synthetic test covered "a
client for whom this framework doesn't apply."
