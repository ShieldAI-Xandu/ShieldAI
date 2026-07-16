# ShieldAI — Compliance Framework Coverage

## The honest claim

> **4 frameworks with full control-level mapping, 4 with AI-assisted gap analysis, 4 more on the roadmap.**

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

### Control-mapped (4)

| Framework | Scope | Source |
|---|---|---|
| **NIST CSF** | The scoring baseline — 5 functions | nist.gov/cyberframework |
| **CIS Controls v8.1** | 18 controls, 153 safeguards, IG1/2/3 | cisecurity.org |
| **HIPAA Security Rule** | 18 standards, 42 specifications (20 required / 22 addressable) | 45 CFR Part 164 Subpart C |
| **FTC Safeguards Rule** | 9 elements of § 314.4, § 314.5 breach notice, § 314.6 exemption | 16 CFR Part 314 |

### AI-assisted (4)
SOC 2 · PCI DSS · ISO 27001 · GDPR — each labelled in the UI, each a candidate
for promotion using the pattern HIPAA and FTC Safeguards now establish.

### Planned (4)
CMMC 2.0 · NIST 800-171 · State Privacy Laws · HITRUST CSF

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
| `frameworks.js` | Registry, depth labels, `assessSelected()`, `coverageSummary()` |
