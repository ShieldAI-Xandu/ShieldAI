# ShieldAI — Compliance Framework Coverage

## The honest claim

> **9 frameworks with full control-level mapping, 1 with AI-assisted gap analysis, 2 more on the roadmap.**

This deliberately does not say "12+ frameworks." Competitors advertise counts;
most of those are a name in a list handed to a language model. Our whole pitch
is that we don't fabricate security data — and a fabricated compliance mapping
*is* fabricated security data. So we publish the distinction instead of hiding
behind the total.

## Depth is a first-class field

Every framework declares how deeply it's implemented. The UI reads this; it
isn't decoration.

| Depth | What it means |
|---|---|
| **control-mapped** | Real controls enumerated in code, each cited to its source and mapped to specific assessment answers. Gap analysis is **computed**. An auditor can trace any finding to a control ID and the answer that produced it. |
| **ai-assisted** | We hold the framework's name and scope; the AI writes a contextual mapping. Useful for orientation — but it's the model's interpretation, and we say so. |
| **planned** | Not implemented. Visible as roadmap, never selectable. |

## Current coverage

### Control-mapped (9)

| Framework | Scope | Source |
|---|---|---|
| **NIST CSF** | The scoring baseline — 5 functions | nist.gov/cyberframework |
| **CIS Controls v8.1** | 18 controls, 153 safeguards, IG1/2/3 | cisecurity.org |
| **HIPAA Security Rule** | 18 standards, 42 specifications (20 required / 22 addressable) | 45 CFR Part 164 Subpart C |
| **SOC 2** | 33 Common Criteria (CC1–CC9) + 3 Availability (A1) = 36 | AICPA Trust Services Criteria |
| **PCI DSS v4.0.1** | 12 requirements, 63 sub-requirements, 9 SAQ types with scoping | PCI Security Standards Council |
| **ISO 27001:2022** | 93 Annex A controls (4 themes) + Clauses 4–10 + SoA logic | ISO/IEC |
| **NIST 800-171 Rev 2** | 110 requirements across 14 families | NIST (public domain) |
| **CMMC 2.0** | Levels 1–3, built on 800-171's 110 | DoD, 32 CFR Part 170 |
| **FTC Safeguards Rule** | 9 elements of § 314.4, § 314.5 breach notice, § 314.6 exemption | 16 CFR Part 314 |

### AI-assisted (1)
GDPR — to be promoted with honest scoping (Article 32 and breach notification
are security; lawful basis and DPIAs are legal determinations, not checklist
items).

## SOC 2 — the detail that matters

**Scope:** Security (mandatory, CC1–CC9) + Availability (A1). Processing
Integrity, Confidentiality, and Privacy are out of scope — include them only if
you've made those commitments.

**The criterion count: we assess 33, not 32.** Public summaries disagree, and
the difference is entirely CC9 — sources saying 32 omit **CC9.2** (vendor and
business-partner risk). CC9.2 exists: AICPA-derived guidance cross-references it
directly, describing a tabletop-exercise control as addressing security (CC9.2)
*and* availability (A1.2, A1.3). We implement 33 and state why, rather than
matching whichever total a blog post prints.

**It's readiness, not compliance.** SOC 2 is principles-based with no fixed
control list — you design controls for your risks and a CPA firm tests them.
Nothing in our product can say a client "passes." What it does say: criterion by
criterion, do your answers suggest you'd have evidence to show an auditor. That
gap list is the thing you work through *before* paying for the audit.

**There is no "SOC 2 certification."** The output says so explicitly. Anyone
selling one is selling a misunderstanding.

**CC6 gets special treatment** — access controls are consistently where
first-time audits find the most gaps, so `accessControlFocus` surfaces that
series on its own.

**Copyright:** AICPA's criterion text is copyrighted. We reference identifiers
(CC6.1, A1.2) and describe coverage in our own words. Never paste AICPA text in.

## SOC 1 — deliberately not offered

SOC 1 is **not a security framework**. It audits internal controls over
financial reporting (SSAE 18 / AT-C 320) so your customer's auditor can rely on
your controls when auditing *their* financials.

It has **no control catalog**. Unlike SOC 2's Trust Services Criteria, there is
nothing predefined to map to — you and your auditor define control objectives
specific to how your processes touch each client's financials. Two SOC 1 reports
in the same industry can share no controls at all.

So an "AI-assisted SOC 1" would mean a model inventing financial control
objectives for a business it barely knows, for an audience of CPAs testing ICFR.
That's the fabrication we refuse to ship.

`SOC1_GUIDANCE` in `soc2.js` exists so the product can answer well when asked:
what SOC 1 actually is, who needs it (payroll processors, claims administrators,
loan servicers — not your typical SMB), and what to do instead. An SMB asked for
"a SOC report" usually needs SOC 2 and doesn't know it. Telling them that is real
advice; pretending to assess SOC 1 isn't.

### Planned (2)
State Privacy Laws (CCPA/CPRA core) · NIST 800-53

## Why HIPAA and FTC Safeguards first

**HIPAA** — your demo persona is a dental practice, and healthcare is the
densest concentration of SMBs with a hard federal obligation and no security
staff.

**FTC Safeguards** — the most underserved framework in the SMB market. It
applies to auto dealers, tax preparers, accountants, mortgage brokers, and
collection agencies, and almost nobody markets to them. Your own business plan
names it as reaching "deep into the small-business tier." It's also the smallest
clean ruleset (9 elements), which made it the ideal place to prove the pattern.

Both are US federal law — no copyright constraints on the source text, unlike
ISO 27001.

## What "control-mapped" buys you

Each control carries:
- **`citation`** — the exact subsection (`§ 164.312(a)(2)(i)`)
- **`nistFunctions`** — how it maps onto the deterministic score you already compute
- **`evidence`** — the checklist item IDs that decide its status

Status is computed from those answers: **met** (≥80), **partial** (45–79),
**gap** (<45), or **unknown** — and *unknown never counts as compliant*. An
empty assessment reports `coveragePct: null`, not 100%.

## Two details that matter legally

**HIPAA: "addressable" ≠ "optional."** Under § 164.306(d)(3) you must assess
each addressable specification, then implement it, implement an equivalent, or
**document why neither is reasonable**. Treating addressable as "skip" without
documentation is the most common finding in OCR investigations. Our output says
this every time, and required gaps are kept in a separate list from addressable
ones — they are not legally equivalent.

**FTC: the § 314.6 exemption is narrower than people think.** Under 5,000
*consumers* relaxes four obligations (written risk assessment, monitoring
cadence, IR plan, annual report). Everything else still applies in full. We
surface relaxed elements as context, never as a pass.

## Scope boundaries we state explicitly

- **HIPAA** — Security Rule only. Privacy Rule (Subpart E), Breach Notification
  (Subpart D), and state health-privacy law are separate and not assessed.
- **PCI DSS** — when promoted to control-mapped, build the full 12 requirements
  *with SAQ scoping as a filter*. An SMB on a hosted payment page files SAQ-A
  (~30 controls); showing them ~220 "not applicable" items makes the product
  look broken.
- **ISO 27001** — the standard's text is copyrighted. We can reference control
  IDs and titles and write original guidance; we cannot reproduce the standard.

## Extending this

`ftcSafeguards.js` is the reference implementation — smallest and cleanest.
The pattern:

1. Enumerate real controls with citations
2. Map each to `nistFunctions` and `evidence` (checklist item IDs)
3. Write an `assess()` that computes status from answers only
4. Register in `frameworks.js` with `depth: DEPTH.CONTROL_MAPPED`
5. Never let an unmapped control count as compliant

## Files

| File | Contents |
|---|---|
| `ftcSafeguards.js` | 9 elements, § 314.5 notification, § 314.6 exemption, `assessFtcSafeguards()` |
| `hipaaSecurityRule.js` | 18 standards, 42 specs, required/addressable, `assessHipaaSecurity()` |
| `soc2.js` | 33 CC + 3 A1, `assessSoc2()`, `SOC1_GUIDANCE` (not offered) |
| `frameworks.js` | Registry, depth labels, `assessSelected()`, `coverageSummary()` |


## PCI DSS — SAQ scoping is the whole design

**Version: v4.0.1.** The 51 requirements v4.0 introduced as "future-dated best
practices" became **mandatory on 31 March 2025**. No grace period remains. Any
tool still calling them best practices is giving 2024 advice — the assessment
surfaces v4.0 gaps separately for exactly this reason.

**The problem SAQ scoping solves.** PCI DSS is 12 requirements and ~250
sub-requirements at full depth. Almost no SMB is responsible for all of them:
the Self-Assessment Questionnaire you file — determined by *how* you take
payments — defines what applies. Showing a dental practice 250 requirements
isn't thoroughness, it's noise that buries the ~7 things they must actually do.

Measured, in-scope sub-requirements by profile:

| Profile | SAQ | In scope | Scoped out |
|---|---|---|---|
| Dental practice, hosted payment page | A | **7** / 63 | 56 |
| P2PE terminal | P2PE | **4** / 63 | 59 |
| Retailer, integrated POS | C | 50 / 63 | 13 |
| E-commerce, Direct Post | A-EP | 53 / 63 | 10 |
| Stores card data (subscription) | D-Merchant | 61 / 63 | 2 |
| Service provider | D-Service | 63 / 63 | 0 |

**SAQ A is 7 items, not 63.** That's the difference between an SMB engaging with
PCI or ignoring it entirely.

**The advice is worth more than the gap analysis.** For an A-EP merchant, moving
from Direct Post to an iframe drops them to SAQ A — one integration change,
46 fewer requirements. For a SAQ D merchant, tokenization usually removes the
need to store card data at all. `scopeAdvice` says this explicitly per SAQ.

**We never under-scope.** An unknown payment profile returns SAQ D (the largest)
flagged `confident: false`, not an optimistic guess. Under-scoping surfaces
during a breach investigation — the worst possible moment.

**Granularity, stated honestly.** We assess at the sub-requirement level (8.3),
which is right for gap analysis. The standard decomposes further (8.3.1, 8.3.2)
to ~250 items for SAQ D. `granularityNote` says so rather than implying we cover
all 250.

**D-Merchant excludes exactly 12.4 and 12.9** — both are genuinely
service-provider-only obligations. Not a scoping bug.

**Copyright:** PCI SSC's text is copyrighted. We reference requirement numbers
and describe coverage in our own words.


## ISO 27001 — Annex A is a menu, not a checklist

**Structure:** 93 Annex A controls in 4 themes — Organizational 37 (A.5.1–5.37),
People 8 (A.6.1–6.8), Physical 14 (A.7.1–7.14), Technological 34 (A.8.1–8.34).
Verified: every ID present, in order, no gaps or duplicates. Plus Clauses 4–10.

**The thing most tools get wrong.** You are certified against **Clauses 4–10**,
not Annex A. Annex A is a *reference catalogue* — you select controls based on
your risk assessment and justify every exclusion in a **Statement of
Applicability**.

So a tool reporting *"43 of 93 implemented = 46% compliant"* has misunderstood
the standard. An organization with 30 applicable controls, all implemented, and
a defensible SoA is in better shape than one with 93 half-done. **We never
produce that number** — `scoringNote` says so explicitly, and coverage is
expressed over in-scope controls only.

**SoA logic, tested:**
- A business with no software development excluding A.8.25/26/28/29/31 → 87 in
  scope, **no warning**. That's correct ISO practice.
- Excluding 90 controls with no recorded reason → **all 90 flagged**: *"an
  auditor will ask about each one."*

**11 new controls in 2022** (A.5.7 threat intelligence, A.5.23 cloud, A.8.11
data masking, A.8.12 DLP…) are surfaced separately — an ISMS built against
ISO 27001:2013 has these as genuinely new work.

**Copyright:** ISO's text is copyrighted and *sold*, not published. We reference
control IDs and short titles and describe coverage in our own words. The
disclaimer tells clients plainly they must buy the standard to implement it.

## HITRUST — not offered, and this is recorded permanently

**The licence prohibits it.** Recorded in `NOT_OFFERED` in `frameworks.js` so it
doesn't get re-litigated:

1. **Derivative works are prohibited.** HITRUST's CSF states *"Any commercial
   uses or creations of derivative works are prohibited"*, and the licence
   defines "derivative work" to include any software *"based on or incorporate
   any part of the HITRUST CSF... in which the HITRUST CSF may be recast or
   adapted."* A control-mapped implementation is exactly that.

2. **ShieldAI likely can't be a licensee at all.** Licensees must be HITRUST
   Qualified Organizations, and *security service providers, consultants, and
   vendors are explicitly prohibited* — which describes ShieldAI.

3. **A commercial GRC vendor already reached this conclusion.** SimpleRisk does
   not implement HITRUST CSF in their GRC tool, citing these licensing terms.

**This is not caution — it's what the licence says.** Shipping it would mean
commercial use of a work whose licence forbids commercial derivatives, by an
excluded entity type, against a company whose business is enforcing that
framework.

**Replaced by NIST 800-53 (Low/Moderate)** — public domain, and the catalogue
800-171 derives from, so building it makes CMMC and 800-171 cheaper rather than
costing extra.


## NIST 800-171 + CMMC — the revision trap

**Rev 3 is newer. Rev 2 is what binds you.** This is the most counterintuitive
call in the whole framework set, and getting it wrong would actively harm a
defence contractor.

| | Rev 2 (Feb 2020) | Rev 3 (May 2024) |
|---|---|---|
| Requirements | **110** | 97 |
| Families | 14 | 17 (+PL, SA, SR) |
| NIST status | **Deprecated May 2025** | Current |
| DoD status | **What you're assessed against** | Not currently applicable |

NIST deprecated Rev 2. But the CMMC Final Rule states Rev 3 is not applicable,
DoD holds a waiver keeping contractors on Rev 2, and **CMMC Phase 2 begins
10 November 2026 with assessors measuring Rev 2's 110 controls.**

A contractor assessed this year needs Rev 2. Shipping Rev 3 alone would hand
them the wrong control set at the exact moment they're measured. **We default to
Rev 2, say why, and track Rev 3 as coming** — including the wrinkle that Rev 3
has *fewer* requirements but a *heavier* assessment burden (~422 determination
statements, up about a third).

**CMMC adds no controls.** Level 2 *is* 800-171 Rev 2's 110 requirements. So
`cmmc.js` wraps `nist800171.js` rather than duplicating it — two copies would
drift apart, and building 800-171 first is exactly what made CMMC nearly free.

- **Level 1** — 17 practices (FCI), annual self-assessment. A real subset of the 110.
- **Level 2** — all 110 (CUI). Self- or C3PAO-assessed every three years.
- **Level 3** — Level 2 + selected 800-172 enhanced requirements, DCMA DIBCAC.
  **We assess the Level 2 foundation and say plainly that the 800-172 layer
  isn't modelled** — those are selected per programme, and guessing would be
  worse than admitting the gap.

**We do not compute an SPRS score.** DoD's methodology weights each control 5/3/1
against a maximum of 110, and that number is **submitted to the government as a
contractual representation**. Deriving it from a general security assessment
would produce a wrong number in a place where wrong has consequences. We say so
and point at the DoD Assessment Methodology instead.

**Two things deliberately absent, for the same reason:** the Basic/Derived split
per family, and SPRS point weights. Both are real parts of the standard; neither
is verified here. On a framework people are contractually assessed against, an
unverified flag is worse than an absent one.

**Public domain** — no copyright constraints on either. A welcome change from
ISO, SOC 2, PCI, and HITRUST.
