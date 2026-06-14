// policyFormats.js
// Defines the professional document structure for generated policies.
// Universal base sections apply to ALL policies; type-specific sections
// are added for policies that need them (e.g., Incident Response needs
// escalation/severity sections that an Acceptable Use policy does not).
//
// This structure follows the widely-used enterprise/university policy
// convention (Purpose, Scope, Definitions, Policy Statement,
// Responsibilities, Compliance/Enforcement, Exceptions, Related
// Documents, Revision History) — ShieldAI's own template built to that
// professional standard.

// Universal sections every policy includes, in order.
export const UNIVERSAL_SECTIONS = [
  { key: "purpose", heading: "1. Purpose", guidance: "Why this policy exists and the risk it addresses. 2-3 sentences." },
  { key: "scope", heading: "2. Scope", guidance: "Who and what the policy applies to (employees, contractors, systems, data, locations)." },
  { key: "definitions", heading: "3. Definitions", guidance: "Define 3-5 key terms used in the policy in plain language." },
  { key: "policyStatements", heading: "4. Policy Statements", guidance: "The core rules and requirements, as a clear numbered or bulleted list. This is the heart of the document." },
  { key: "responsibilities", heading: "5. Roles & Responsibilities", guidance: "Who is responsible for what (e.g., Management, IT, All Staff). Use a clear role: responsibility format." },
  { key: "compliance", heading: "6. Compliance & Enforcement", guidance: "How compliance is monitored and consequences for violations." },
  { key: "exceptions", heading: "7. Exceptions", guidance: "How exceptions are requested and approved." },
  { key: "related", heading: "8. Related Documents & References", guidance: "Related policies, standards, or regulations (e.g., HIPAA, PCI-DSS, NIST CSF) relevant to this business." },
  { key: "revision", heading: "9. Revision History", guidance: "A table with Version, Date, and Description. Start with Version 1.0, today's date, 'Initial release'." },
];

// Type-specific extra sections, inserted before "Compliance & Enforcement".
// Keyed by policy catalog id.
export const TYPE_SPECIFIC_SECTIONS = {
  "incident-response": [
    { heading: "Incident Severity Levels", guidance: "Define severity tiers (e.g., Low/Medium/High/Critical) with examples for this business." },
    { heading: "Response Procedures", guidance: "Step-by-step response workflow: detect, contain, eradicate, recover, review." },
    { heading: "Escalation & Notification", guidance: "Who to notify, when, and any regulatory breach-notification timelines that apply." },
  ],
  "data-classification": [
    { heading: "Data Classification Levels", guidance: "Define tiers (e.g., Public, Internal, Confidential, Restricted) with examples of each for this business." },
    { heading: "Handling Requirements by Level", guidance: "Storage, transmission, and disposal requirements for each classification level." },
  ],
  "data-retention": [
    { heading: "Retention Schedule", guidance: "A table of data types and how long each is retained, tied to legal/regulatory drivers." },
    { heading: "Secure Disposal Procedures", guidance: "How data and media are securely destroyed at end of retention." },
  ],
  "backup-recovery": [
    { heading: "Backup Schedule & Scope", guidance: "What is backed up, how often, and where backups are stored." },
    { heading: "Recovery Objectives (RTO/RPO)", guidance: "Define Recovery Time Objective and Recovery Point Objective targets." },
    { heading: "Testing & Validation", guidance: "How and how often backups are tested for restorability." },
  ],
  "access-control": [
    { heading: "Access Provisioning & Deprovisioning", guidance: "How access is granted on hire/role change and revoked on departure." },
    { heading: "Access Review", guidance: "How often access rights are reviewed and recertified." },
  ],
  "password-policy": [
    { heading: "Password Requirements", guidance: "Specific complexity, length, rotation, and reuse rules based on the business's answers." },
    { heading: "Multi-Factor Authentication", guidance: "Where MFA is required and accepted methods." },
  ],
  "vendor-risk": [
    { heading: "Vendor Risk Assessment", guidance: "How vendors are evaluated before onboarding and periodically thereafter." },
    { heading: "Contractual Security Requirements", guidance: "Security clauses vendors must agree to (e.g., breach notification, data handling)." },
  ],
  "remote-work": [
    { heading: "Remote Access Requirements", guidance: "VPN, device security, and network requirements for remote work." },
    { heading: "Acceptable Use of Personal Devices", guidance: "BYOD rules and required controls." },
  ],
  "email-security": [
    { heading: "Phishing & Social Engineering", guidance: "How to recognize and report phishing; reporting procedure." },
    { heading: "Sensitive Data in Email", guidance: "Rules for sending sensitive data, encryption requirements." },
  ],
  "change-management": [
    { heading: "Change Request & Approval", guidance: "How changes are requested, reviewed, and approved." },
    { heading: "Testing & Rollback", guidance: "Testing requirements and rollback procedures for failed changes." },
  ],
  "physical-security": [
    { heading: "Facility Access Controls", guidance: "How physical access to premises and equipment is controlled." },
    { heading: "Equipment & Media Security", guidance: "Securing devices, clean desk, and media handling." },
  ],
};

// Build the full ordered section plan for a given policy id.
export function buildSectionPlan(policyId) {
  const extra = TYPE_SPECIFIC_SECTIONS[policyId] || [];
  // Insert type-specific sections after "Policy Statements" (index of policyStatements)
  // and before Compliance. We renumber in the prompt instructions.
  const base = [...UNIVERSAL_SECTIONS];
  if (extra.length === 0) return base;

  // Find insertion point: right after "responsibilities"
  const insertAfterKey = "responsibilities";
  const idx = base.findIndex(s => s.key === insertAfterKey);
  const before = base.slice(0, idx + 1);
  const after = base.slice(idx + 1);
  const extraSections = extra.map((e, i) => ({
    key: `typeSpecific${i}`,
    heading: e.heading,
    guidance: e.guidance,
  }));
  return [...before, ...extraSections, ...after];
}

// Produce the prompt text describing the required structure.
export function buildStructurePrompt(policyId) {
  const plan = buildSectionPlan(policyId);
  // Renumber headings sequentially so the doc reads cleanly
  let n = 1;
  const lines = plan.map(s => {
    // strip any leading "N. " from the base heading and renumber
    const cleanHeading = s.heading.replace(/^\d+\.\s*/, "");
    const numbered = `## ${n}. ${cleanHeading}`;
    n++;
    return `${numbered}\n   ${s.guidance}`;
  });
  return lines.join("\n");
}
