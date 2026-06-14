// securityChecklist.js
// Structured questions mapped directly to the risk engine's NIST factors.
// Each answer feeds scoring deterministically — no keyword inference.
//
// `factor` ties each question to a scoring factor in riskEngine.js.
// `scoreMap` converts each answer option to a 0-100 factor score.

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
];
