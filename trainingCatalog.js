// trainingCatalog.js
// The fixed CISA/NIST-aligned topic backbone for ShieldAI's training programs.
// AI tailors the *details* (examples, scenarios, emphasis) per company, but the
// curriculum structure and core topics come from here — giving consistency and
// citable credibility (CISA Cyber Guidance, NIST IR 7621, StopRansomware).

// Each topic has a stable id, title, audience, the core learning objectives,
// and the source authority it maps to. The AI fills in company-tailored
// scenarios, examples, and quiz questions around this backbone.

export const TRAINING_TOPICS = [
  {
    id: "phishing",
    title: "Phishing & Social Engineering",
    audience: "All Staff",
    duration: "30 min",
    priority: 1,
    source: "CISA Cyber Guidance for Small Businesses",
    objectives: [
      "Recognize phishing emails, texts, QR codes, and fake invoices",
      "Identify executive-impersonation and password-reset scams",
      "Know how to report a suspicious message",
    ],
  },
  {
    id: "passwords-mfa",
    title: "Passwords & Multi-Factor Authentication",
    audience: "All Staff",
    duration: "20 min",
    priority: 2,
    source: "CISA Cyber Guidance for Small Businesses",
    objectives: [
      "Use a password manager and unique passwords",
      "Enable MFA on email, banking, payroll, and cloud apps",
      "Understand why admin and finance accounts need extra protection",
    ],
  },
  {
    id: "bec",
    title: "Business Email Compromise & Payment Fraud",
    audience: "Finance, Leadership",
    duration: "30 min",
    priority: 3,
    source: "FTC / CISA",
    objectives: [
      "Require callback verification for bank or vendor payment changes",
      "Spot urgent wire-transfer and gift-card request scams",
      "Follow a dual-approval process for payment changes",
    ],
  },
  {
    id: "ransomware",
    title: "Ransomware Awareness & Prevention",
    audience: "All Staff",
    duration: "30 min",
    priority: 4,
    source: "CISA StopRansomware Guide",
    objectives: [
      "Understand how ransomware starts and spreads",
      "Avoid unknown USB devices and suspicious downloads",
      "Know who to contact immediately if something looks wrong",
    ],
  },
  {
    id: "payments",
    title: "Secure Payment & Transaction Verification",
    audience: "Finance",
    duration: "20 min",
    priority: 5,
    source: "FTC",
    objectives: [
      "Verify payment requests through a known, separate channel",
      "Recognize invoice-fraud and vendor-impersonation red flags",
      "Document and approve changes to payment details",
    ],
  },
  {
    id: "data-privacy",
    title: "Data Protection & Customer Privacy",
    audience: "All Staff",
    duration: "25 min",
    priority: 6,
    source: "NIST IR 7621 (Small Business Information Security)",
    objectives: [
      "Identify sensitive data: customer records, payment data, credentials, IP",
      "Handle, store, and share sensitive data appropriately",
      "Understand the company's privacy obligations",
    ],
  },
  {
    id: "device-security",
    title: "Device & Mobile Security",
    audience: "All Staff",
    duration: "20 min",
    priority: 7,
    source: "CISA Cyber Guidance for Small Businesses",
    objectives: [
      "Lock screens, use approved software, avoid shared accounts",
      "Keep work and personal devices separated where possible",
      "Report lost or stolen devices immediately",
    ],
  },
  {
    id: "updates-patching",
    title: "Software Updates & Patching",
    audience: "All Staff, IT",
    duration: "15 min",
    priority: 8,
    source: "CISA Cyber Guidance for Small Businesses",
    objectives: [
      "Understand why timely updates matter",
      "Recognize legitimate vs. fake update prompts",
      "Know the risk of unsupported software",
    ],
  },
  {
    id: "remote-wifi",
    title: "Wi-Fi & Remote Work Security",
    audience: "All Staff",
    duration: "20 min",
    priority: 9,
    source: "NIST Small Business Cybersecurity Corner",
    objectives: [
      "Secure home Wi-Fi and avoid risky public networks",
      "Use VPN for sensitive work",
      "Separate work and personal use where possible",
    ],
  },
  {
    id: "backups-recovery",
    title: "Backups & Recovery Basics",
    audience: "All Staff, IT",
    duration: "20 min",
    priority: 10,
    source: "CISA StopRansomware Guide",
    objectives: [
      "Know what gets backed up and how often",
      "Understand why offline/cloud-protected backups matter",
      "Recognize the employee's role in recovery readiness",
    ],
  },
  {
    id: "incident-reporting",
    title: "Incident Reporting & Response",
    audience: "All Staff",
    duration: "25 min",
    priority: 11,
    source: "CISA SMB Incident Response Resources",
    objectives: [
      "Know who to contact and what to report",
      "Understand what NOT to delete or alter",
      "Escalate suspicious activity quickly",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use & Security Policies",
    audience: "All Staff",
    duration: "20 min",
    priority: 12,
    source: "NIST IR 7621",
    objectives: [
      "Understand rules for company systems and personal devices",
      "Follow policy for cloud storage, removable media, and software installs",
      "Acknowledge understanding when policies change",
    ],
  },
];

// Manager/owner add-on topics (higher-responsibility training)
export const MANAGER_TOPICS = [
  {
    id: "risk-ownership",
    title: "Risk Ownership & Governance",
    audience: "Owners, Managers",
    duration: "30 min",
    source: "NIST IR 7621",
    objectives: [
      "Own cybersecurity risk decisions for the business",
      "Understand cyber-insurance requirements and obligations",
      "Make informed incident-response decisions",
    ],
  },
  {
    id: "vendor-risk",
    title: "Vendor & Supply-Chain Risk",
    audience: "Owners, Managers",
    duration: "25 min",
    source: "NIST / CISA",
    objectives: [
      "Assess third-party vendor security",
      "Set contractual security requirements",
      "Monitor supply-chain risk over time",
    ],
  },
  {
    id: "access-reviews",
    title: "Access Reviews & Offboarding",
    audience: "Owners, Managers, IT",
    duration: "20 min",
    source: "NIST CSF",
    objectives: [
      "Conduct periodic access recertification",
      "Revoke access promptly on role change or departure",
      "Enforce least-privilege access",
    ],
  },
];

// The default 3-month + quarterly structure (from the CISA/NIST-aligned plan).
// The AI maps topics into this schedule and tailors emphasis to the company.
export const DEFAULT_SCHEDULE = [
  { phase: "Month 1", theme: "Cybersecurity Basics",
    topicIds: ["phishing", "passwords-mfa", "device-security", "incident-reporting"] },
  { phase: "Month 2", theme: "Protecting Money & Customer Data",
    topicIds: ["bec", "payments", "data-privacy", "acceptable-use"] },
  { phase: "Month 3", theme: "Ransomware & Recovery",
    topicIds: ["ransomware", "backups-recovery", "updates-patching", "remote-wifi"] },
  { phase: "Quarterly Refresher", theme: "Reinforcement",
    topicIds: ["phishing"], note: "Short phishing simulations, policy reminders, and a 15-minute 'what changed' session." },
];

export function getTopic(id) {
  return TRAINING_TOPICS.find(t => t.id === id) || MANAGER_TOPICS.find(t => t.id === id);
}
