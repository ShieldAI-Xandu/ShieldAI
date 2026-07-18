# ShieldAI — Framework Choice: NIST, CIS, or Both

## What you asked for

The client chooses their scoring foundation at the start of the assessment —
NIST CSF, CIS Controls, or both — and the posture score is computed against
whichever they chose. Previously NIST CSF was hardcoded as the only scoring
baseline (`always: true`, un-toggleable) and CIS was a plain compliance checkbox
that produced a gap analysis but never a score.

## The design decision that mattered

The posture score has always run entirely through NIST CSF's five functions.
"Score against whichever they chose" meant building a real CIS scoring path —
not faking one, and not quietly keeping NIST underneath.

**The rule I held to: a framework choice cannot change how secure a business is.**
Same answers, same underlying arithmetic — only the grouping and the label
differ. A business that scores 65 in NIST terms scores 64 in CIS terms because
the two frameworks weight things slightly differently, not because one of them
found something the other missed. They agree within a narrow band by
construction, and the test suite enforces that they can't drift apart into two
contradictory verdicts.

So CIS scoring reuses the exact same 13 checklist factors, regrouped from NIST's
five functions into four CIS "Basic Cyber Hygiene" areas (Identify & Protect
Assets, Secure Access & Data, Detect & Defend, Respond & Recover). The numbers
underneath are identical; the client just reads them in the vocabulary they
picked.

## How the three lenses behave

| Lens | Headline score | Groups | Alternate view |
|---|---|---|---|
| **NIST** | NIST CSF | 5 functions | — |
| **CIS** | CIS Controls | 4 hygiene areas | NIST kept available |
| **Both** | **NIST** (authoritative) | 5 functions | CIS attached |

"Both" keeps NIST as the headline number deliberately — it's what insurers and
auditors ask for, so it stays comparable everywhere — with the full CIS view one
click away. A "both" client never sees two competing overall scores.

## The clean part: no call sites changed

`computePostureScore` now reads `frameworkLens` off the assessment data and
routes to the right lens, defaulting to NIST when absent. Because the choice
rides on the data rather than the function signature, all **15 call sites** — the
dashboard, analyst portfolio, task simulator, program generator, demo seed —
got correct behaviour with zero edits. Every existing assessment with no lens
field keeps its exact current NIST behaviour.

## Frontend

- **New step in the assessment flow**: intake → **framework foundation** →
  checklist → analysis. A dedicated screen explains the three options in plain
  language (most SMB owners have heard "NIST" and "CIS" and don't know the
  difference) and states it's changeable, not locked in.
- The checklist's framework picker now locks whichever frameworks the lens
  chose as the "foundation" (shown as *your foundation*) instead of always
  locking NIST. Additional compliance frameworks still stack on top freely.
- The dashboard posture breakdown is labelled by the chosen lens — a CIS client
  no longer sees "NIST CSF Posture Breakdown" over their CIS groups — and a
  collapsible **"Also view in … terms"** section shows the alternate lens for
  CIS and both clients.

## Demo

The three demo companies now each showcase a different lens, so a walkthrough
covers all three paths:

| Company | Lens | Score | Why |
|---|---|---|---|
| Meridian Dental | NIST | 61 Moderate | Healthcare — insurers and HIPAA speak CSF |
| Lakeside Financial | Both | 99 Strong | Mature, pursuing certification, multiple parties |
| Apex Manufacturing | CIS | 32 At Risk | Wants a concrete do-this-next roadmap |

## Verification

Ten suites green, including new lens tests that assert: NIST and CIS agree within
a reasonable band, "both" keeps the NIST headline, an all-best assessment is
never worse than Moderate under any lens, and the stored-field path is backwards
compatible. Full flow verified over HTTP — lens persists on the assessment, the
engine reads it, the overview reflects it. Demo seed validated (105 answers, 0
invalid). Build clean.

## Note

CIS scoring uses IG1's hygiene grouping for the posture lens. The separate CIS
*compliance* assessment (the 18-control walkthrough with IG1/IG2/IG3 scoping)
is unchanged and still available to any client regardless of their posture lens —
the two are independent, as they should be.
