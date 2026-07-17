// securityChecklist.js
// Structured questions mapped directly to the risk engine's NIST factors.
// Each answer feeds scoring deterministically — no keyword inference.
//
// `factor` ties each question to a scoring factor in riskEngine.js.
// `scoreMap` converts each answer option to a 0-100 factor score.
//
// TWO KINDS OF QUESTION — READ THIS BEFORE ADDING ONE
// ----------------------------------------------------
// The 13 original questions are POSTURE questions. They carry a `nistFunction`
// and a `factor`, and riskEngine.js weights them into the NIST CSF posture
// score. Those weights sum to 1.0 within each function.
//
// That creates a trap. riskEngine's scoreFromChecklist() iterates every entry
// in this array and normalises by total weight, so ADDING A SCORING QUESTION
// SILENTLY RE-WEIGHTS EVERY EXISTING CLIENT'S POSTURE SCORE. A client who
// scored 65 last month would score something else today with no change in
// their security. For a product whose entire claim is a deterministic,
// explainable, repeatable score, that is the worst possible bug: it is
// invisible, it is retroactive, and it discredits the number.
//
// So questions added for framework evidence carry `scoring: false`. The risk
// engine skips them entirely; the posture score is unchanged, byte for byte.
// They exist to give control-mapped frameworks real evidence to assess
// against — which is the actual bottleneck, since 13 signals cannot honestly
// cover 110 CUI requirements or 149 800-53 controls.
//
//   scoring: true / omitted   Feeds the NIST posture score. Changing this set
//                             changes every score ever produced. Don't, unless
//                             you are deliberately versioning the methodology.
//
//   scoring: false            Evidence only. Frameworks read it; the score
//                             never sees it. Safe to add.
//
// `section` groups questions in the intake UI. `appliesTo` (optional) limits a
// question to clients who selected a given framework — nobody should be asked
// about CUI marking if they don't touch defense contracts.

export const SECURITY_CHECKLIST = [
  // ── PROTECT ──────────────────────────────────────────────
  {
    id: "mfa",
    nistFunction: "Protect",
    factor: "mfa",
    question: "Does your organization use multi-factor authentication (MFA)?",
    options: [
      { label: "Yes, required on all accounts", score: 100 },
      { label: "Yes, but only on some accounts (e.g., admin)", score: 65 },
      { label: "No, but planning to add it", score: 25 },
      { label: "No / not sure", score: 10 },
    ],
  },
  {
    id: "endpoint",
    nistFunction: "Protect",
    factor: "endpoint",
    question: "What endpoint/antivirus protection is on your computers?",
    options: [
      { label: "Advanced EDR (CrowdStrike, SentinelOne, etc.)", score: 100 },
      { label: "Built-in protection (Windows Defender, etc.)", score: 60 },
      { label: "Basic/free antivirus", score: 40 },
      { label: "None / not sure", score: 15 },
    ],
  },
  {
    id: "training",
    nistFunction: "Protect",
    factor: "training",
    question: "Do employees receive security awareness training?",
    options: [
      { label: "Yes, regular training + phishing simulations", score: 100 },
      { label: "Yes, occasional/annual training", score: 65 },
      { label: "Informal or one-time only", score: 35 },
      { label: "No training", score: 15 },
    ],
  },
  {
    id: "itManagement",
    nistFunction: "Protect",
    factor: "itManagement",
    question: "Who manages your IT and security?",
    options: [
      { label: "Dedicated in-house IT/security staff", score: 90 },
      { label: "Outsourced IT provider (MSP)", score: 75 },
      { label: "One person handles it part-time", score: 45 },
      { label: "No one specifically / ad-hoc", score: 20 },
    ],
  },

  // ── IDENTIFY ─────────────────────────────────────────────
  {
    id: "dataInventory",
    nistFunction: "Identify",
    factor: "dataInventory",
    question: "Do you know exactly what sensitive data you store and where?",
    options: [
      { label: "Yes, fully documented inventory", score: 100 },
      { label: "Mostly — we have a general idea", score: 60 },
      { label: "Vague understanding only", score: 35 },
      { label: "No / never assessed", score: 15 },
    ],
  },
  {
    id: "priorAudit",
    nistFunction: "Identify",
    factor: "priorAudit",
    question: "When was your last security assessment or audit?",
    options: [
      { label: "Within the last year (or formally certified)", score: 100 },
      { label: "1-2 years ago", score: 60 },
      { label: "More than 2 years ago", score: 35 },
      { label: "Never", score: 15 },
    ],
  },
  {
    id: "documentedPolicies",
    nistFunction: "Identify",
    factor: "documentedPolicies",
    question: "Do you have written security policies?",
    options: [
      { label: "Yes, a full set of documented policies", score: 100 },
      { label: "A few key policies", score: 60 },
      { label: "One or two informal documents", score: 35 },
      { label: "None", score: 15 },
    ],
  },

  // ── DETECT ───────────────────────────────────────────────
  {
    id: "monitoring",
    nistFunction: "Detect",
    factor: "monitoring",
    question: "Do you have security monitoring or logging in place?",
    options: [
      { label: "Yes, active monitoring (SIEM/SOC or managed)", score: 100 },
      { label: "Some logging, reviewed occasionally", score: 55 },
      { label: "Minimal / only what comes built-in", score: 35 },
      { label: "No monitoring", score: 15 },
    ],
  },
  {
    id: "emailSecurity",
    nistFunction: "Detect",
    factor: "emailSecurity",
    question: "What email security / spam filtering do you use?",
    options: [
      { label: "Advanced email security (Proofpoint, Mimecast, etc.)", score: 100 },
      { label: "Built-in filtering (Microsoft 365 / Google Workspace)", score: 65 },
      { label: "Basic spam filter only", score: 40 },
      { label: "None / not sure", score: 20 },
    ],
  },

  // ── RESPOND ──────────────────────────────────────────────
  {
    id: "incidentResponse",
    nistFunction: "Respond",
    factor: "incidentResponse",
    question: "Do you have an incident response plan?",
    options: [
      { label: "Yes, documented and tested", score: 100 },
      { label: "Yes, documented but not tested", score: 70 },
      { label: "Informal / in our heads only", score: 35 },
      { label: "No plan", score: 15 },
    ],
  },
  {
    id: "responseSupport",
    nistFunction: "Respond",
    factor: "responseSupport",
    question: "If a serious breach happened today, who would respond?",
    options: [
      { label: "Retained security firm / MSP on call", score: 90 },
      { label: "Internal IT staff", score: 70 },
      { label: "We'd figure it out / call someone", score: 35 },
      { label: "Not sure", score: 15 },
    ],
  },

  // ── RECOVER ──────────────────────────────────────────────
  {
    id: "backups",
    nistFunction: "Recover",
    factor: "backups",
    question: "How are your critical data and systems backed up?",
    options: [
      { label: "Automated, offsite/cloud backups (tested)", score: 100 },
      { label: "Automated backups, not regularly tested", score: 70 },
      { label: "Manual or occasional backups", score: 40 },
      { label: "No backups / not sure", score: 15 },
    ],
  },
  {
    id: "disasterRecovery",
    nistFunction: "Recover",
    factor: "disasterRecovery",
    question: "Do you have a disaster recovery / business continuity plan?",
    options: [
      { label: "Yes, documented with recovery time goals", score: 100 },
      { label: "Yes, a basic plan", score: 65 },
      { label: "Informal understanding only", score: 35 },
      { label: "No plan", score: 15 },
    ],
  },

  // ══════════════════════════════════════════════════════════
  //  EVIDENCE-ONLY QUESTIONS — scoring: false
  //  These do not touch the posture score. See the header note.
  // ══════════════════════════════════════════════════════════

  // ── Access & identity ────────────────────────────────────
  {
    id: "accessReviews",
    scoring: false,
    section: "Access & Identity",
    question: "How often do you review who has access to what?",
    options: [
      { label: "Formal reviews at least quarterly, documented", score: 100 },
      { label: "Annually, or informally when we remember", score: 60 },
      { label: "Only when someone leaves", score: 35 },
      { label: "Never / not sure", score: 10 },
    ],
  },
  {
    id: "offboarding",
    scoring: false,
    section: "Access & Identity",
    question: "When someone leaves, how quickly is their access removed?",
    options: [
      { label: "Same day, via a documented checklist", score: 100 },
      { label: "Within a few days", score: 60 },
      { label: "Eventually — it's ad-hoc", score: 30 },
      { label: "Accounts often stay active / not sure", score: 10 },
    ],
  },
  {
    id: "privilegedAccess",
    scoring: false,
    section: "Access & Identity",
    question: "How are administrator/privileged accounts handled?",
    options: [
      { label: "Separate admin accounts, MFA, access logged and time-limited", score: 100 },
      { label: "Separate admin accounts with MFA", score: 70 },
      { label: "Some people have admin on their normal account", score: 30 },
      { label: "Most users are local admins / not sure", score: 10 },
    ],
  },
  {
    id: "passwordPolicy",
    scoring: false,
    section: "Access & Identity",
    question: "How are passwords managed?",
    options: [
      { label: "Password manager issued company-wide, complexity enforced", score: 100 },
      { label: "Enforced complexity rules, no manager", score: 60 },
      { label: "Guidance only — people do their own thing", score: 30 },
      { label: "No policy / shared passwords in use", score: 10 },
    ],
  },

  // ── Data protection ──────────────────────────────────────
  {
    id: "encryptionAtRest",
    scoring: false,
    section: "Data Protection",
    question: "Is sensitive data encrypted where it's stored?",
    options: [
      { label: "Yes — full-disk plus database/file encryption, keys managed", score: 100 },
      { label: "Full-disk encryption on laptops and servers", score: 65 },
      { label: "Some systems only", score: 35 },
      { label: "No / not sure", score: 10 },
    ],
  },
  {
    id: "encryptionInTransit",
    scoring: false,
    section: "Data Protection",
    question: "Is data encrypted when it moves across networks?",
    options: [
      { label: "TLS everywhere, enforced and monitored for weak ciphers", score: 100 },
      { label: "HTTPS/TLS on everything public-facing", score: 70 },
      { label: "Mostly, but some internal traffic is plaintext", score: 40 },
      { label: "No / not sure", score: 10 },
    ],
  },
  {
    id: "dataRetention",
    scoring: false,
    section: "Data Protection",
    question: "Do you have a data retention and disposal schedule?",
    options: [
      { label: "Yes, documented, enforced, with secure disposal", score: 100 },
      { label: "Documented but not consistently enforced", score: 55 },
      { label: "Informal — we delete things when we notice", score: 30 },
      { label: "We keep everything indefinitely / not sure", score: 10 },
    ],
  },
  {
    id: "mediaDisposal",
    scoring: false,
    section: "Data Protection",
    question: "How do you dispose of old drives, laptops, and paper records?",
    options: [
      { label: "Certified destruction/wiping with documented chain of custody", score: 100 },
      { label: "We wipe or shred, no formal record", score: 60 },
      { label: "Devices get reused or sit in a closet", score: 25 },
      { label: "Not sure", score: 10 },
    ],
  },

  // ── Vendors & third parties ──────────────────────────────
  {
    id: "vendorInventory",
    scoring: false,
    section: "Vendors & Third Parties",
    question: "Do you track which vendors handle your sensitive data?",
    options: [
      { label: "Documented inventory with data types and contracts", score: 100 },
      { label: "We have a list of vendors", score: 55 },
      { label: "We could reconstruct it if asked", score: 30 },
      { label: "No / not sure", score: 10 },
    ],
  },
  {
    id: "vendorDueDiligence",
    scoring: false,
    section: "Vendors & Third Parties",
    question: "Do you assess vendors' security before signing?",
    options: [
      { label: "Yes — questionnaire or SOC 2 review, documented, periodic re-review", score: 100 },
      { label: "We ask for a SOC 2 or similar at onboarding", score: 65 },
      { label: "Only for the largest vendors", score: 35 },
      { label: "No / not sure", score: 10 },
    ],
  },
  {
    id: "vendorContracts",
    scoring: false,
    section: "Vendors & Third Parties",
    question: "Do your vendor contracts include security and data-handling terms?",
    options: [
      { label: "Yes — security terms plus DPAs/BAAs where required", score: 100 },
      { label: "Standard terms, security language in some", score: 55 },
      { label: "Rarely — we sign their paper", score: 25 },
      { label: "No / not sure", score: 10 },
    ],
  },

  // ── Governance ───────────────────────────────────────────
  {
    id: "riskAssessmentCadence",
    scoring: false,
    section: "Governance",
    question: "How often do you formally assess security risk?",
    options: [
      { label: "At least annually, documented, with tracked remediation", score: 100 },
      { label: "Annually, informally", score: 55 },
      { label: "Only when a customer or insurer asks", score: 30 },
      { label: "Never", score: 10 },
    ],
  },
  {
    id: "securityOwnership",
    scoring: false,
    section: "Governance",
    question: "Who is formally accountable for security decisions?",
    options: [
      { label: "A named individual with documented authority and budget", score: 100 },
      { label: "A named individual, informally", score: 60 },
      { label: "Shared across leadership — no single owner", score: 30 },
      { label: "Nobody specifically", score: 10 },
    ],
  },
  {
    id: "policyReviewCadence",
    scoring: false,
    section: "Governance",
    question: "How often are security policies reviewed and approved?",
    options: [
      { label: "At least annually, with documented management approval", score: 100 },
      { label: "Occasionally, when something changes", score: 50 },
      { label: "Written once, never revisited", score: 25 },
      { label: "No policies to review", score: 10 },
    ],
  },
  {
    id: "changeManagement",
    scoring: false,
    section: "Governance",
    question: "How are changes to production systems controlled?",
    options: [
      { label: "Documented approval, testing, and rollback for every change", score: 100 },
      { label: "Peer review for significant changes", score: 60 },
      { label: "Informal — people are careful", score: 30 },
      { label: "No process / not sure", score: 10 },
    ],
  },
  {
    id: "vulnManagement",
    scoring: false,
    section: "Governance",
    question: "How do you find and fix vulnerabilities and missing patches?",
    options: [
      { label: "Regular scanning with tracked remediation SLAs", score: 100 },
      { label: "Automatic updates enabled, occasional scans", score: 60 },
      { label: "We patch when something breaks or makes the news", score: 30 },
      { label: "No process / not sure", score: 10 },
    ],
  },
  {
    id: "physicalSecurity",
    scoring: false,
    section: "Governance",
    question: "How is physical access to your offices and equipment controlled?",
    options: [
      { label: "Badge access with logging, visitors escorted, cloud-hosted infra", score: 100 },
      { label: "Locked doors, keys issued to staff", score: 60 },
      { label: "Shared or open workspace", score: 30 },
      { label: "Not sure / not applicable — fully remote", score: 50 },
    ],
  },

  // ── Privacy ──────────────────────────────────────────────
  // This section exists because state privacy laws and GDPR are legal
  // obligations, not security controls. Nothing in the 13 posture questions
  // tells us whether a business honors a deletion request. Without these,
  // a privacy framework can only report "not yet assessed" — which is honest
  // but useless.
  {
    id: "personalDataCategories",
    scoring: false,
    section: "Privacy",
    question: "What categories of personal information do you collect about consumers?",
    options: [
      { label: "Sensitive categories (health, biometric, precise geolocation, government ID)", score: 100 },
      { label: "Standard identifiers plus commercial/behavioral data", score: 70 },
      { label: "Basic contact details only", score: 40 },
      { label: "None — we're B2B and hold no consumer data", score: 0 },
    ],
  },
  {
    id: "privacyNotice",
    scoring: false,
    section: "Privacy",
    question: "Do you publish a privacy notice describing what you collect and why?",
    options: [
      { label: "Yes — categories, purposes, rights, and updated in the last 12 months", score: 100 },
      { label: "Yes, but it's generic or outdated", score: 45 },
      { label: "A short blurb in our terms", score: 25 },
      { label: "No", score: 10 },
    ],
  },
  {
    id: "consumerRights",
    scoring: false,
    section: "Privacy",
    question: "Can consumers request access to, or deletion of, their data?",
    options: [
      { label: "Yes — a defined intake channel, identity verification, tracked to a deadline", score: 100 },
      { label: "Yes, handled manually by whoever gets the email", score: 50 },
      { label: "We'd honor a request but have no process", score: 25 },
      { label: "No / never considered", score: 10 },
    ],
  },
  {
    id: "dataSaleSharing",
    scoring: false,
    section: "Privacy",
    question: "Do you sell or share personal information, or use it for targeted advertising?",
    options: [
      { label: "No — and we've confirmed our ad/analytics tools don't either", score: 100 },
      { label: "Yes, and we offer a working opt-out mechanism", score: 70 },
      { label: "Yes, or we run ad tech and haven't checked what it does", score: 25 },
      { label: "Not sure", score: 10 },
    ],
  },
  {
    id: "privacyRequestVolume",
    scoring: false,
    section: "Privacy",
    question: "Do you track and log privacy requests and how you responded?",
    options: [
      { label: "Yes — logged with dates, outcomes, and metrics we could report", score: 100 },
      { label: "We keep the emails", score: 40 },
      { label: "No record kept", score: 15 },
      { label: "We've never received one", score: 30 },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────

/** Questions that feed the NIST posture score. Changing this set changes every score. */
export const SCORING_CHECKLIST = SECURITY_CHECKLIST.filter(q => q.scoring !== false);

/** Questions that exist purely as framework evidence. Safe to extend. */
export const EVIDENCE_CHECKLIST = SECURITY_CHECKLIST.filter(q => q.scoring === false);

/** Evidence questions grouped by intake section, in declaration order. */
export function evidenceSections() {
  const out = [];
  for (const q of EVIDENCE_CHECKLIST) {
    let s = out.find(x => x.section === q.section);
    if (!s) { s = { section: q.section, questions: [] }; out.push(s); }
    s.questions.push(q);
  }
  return out;
}

/**
 * Normalise raw answers (id -> selected label) into the shape frameworks read:
 * { [id]: { label, score } }. Unanswered questions are ABSENT, not zero —
 * frameworks must be able to distinguish "not yet assessed" from "failed".
 */
export function toEvidence(answers = {}) {
  const out = {};
  for (const q of SECURITY_CHECKLIST) {
    const label = answers[q.id];
    if (!label) continue;
    const opt = q.options.find(o => o.label === label);
    if (!opt) continue;
    out[q.id] = { label: opt.label, score: opt.score };
  }
  return out;
}
