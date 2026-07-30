// seedDemo.js
// One-time script to create polished SHOWCASE accounts for investor demos.
//
// Run with:  node seedDemo.js
//
// What it does:
//   1. Creates a demo login account (demo@shieldai.com / ShieldDemo2026)
//   2. Builds 3 realistic company assessments across different industries,
//      each with varied checklist answers so they score differently.
//   3. Runs each through the REAL AI pipeline to generate a full program.
//   4. If any section fails (or AI is unavailable), fills it with polished
//      hardcoded fallback content so the demo always looks complete.
//   5. Generates a couple of professional policies per company.
//
// Safe to re-run: it removes any previous demo data first.

import "dotenv/config";
import { randomUUID, createHash, randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import db, { runInStore, DEMO_STORE, getStore, PROD_STORE } from "./db.js";
import { DEMO_PERSONAS } from "./demoGateway.js";
import { demoDomainRecord } from "./demoIntel.js";
import { PIPELINE } from "./generators.js";
import { computePostureScore } from "./riskEngine.js";
import { POLICY_CATALOG } from "./policyCatalog.js";
import { buildStructurePrompt } from "./policyFormats.js";
// Feature areas added since this script was last substantially written.
// Each of these is reused directly (not reimplemented) so seeded records are
// exactly as valid as what the real route would produce for a real client.
import { summarizeReport, buildDraftsFromReport, remediationHint } from "./agentRoutes.js";
import { getControl, simulateControlChange } from "./taskRoutes.js";
import { createVendor } from "./vendorRiskService.js";
import { modulesFromTopics, rollup, getOrGenerateModuleContent } from "./trainingProgramRoutes.js";
import { DEFAULT_SCHEDULE } from "./trainingCatalog.js";
import { getScenario } from "./phishingScenarios.js";
import { validateBrandingPatch } from "./brandingRoutes.js";
import { refreshClientExposure } from "./cveService.js";
import { refreshClientDarkweb } from "./darkwebService.js";
import { pushNotification } from "./portfolioRoutes.js";
import { callAI } from "./aiProviders.js";

// Demo identities live ONLY in demo-db.json. The @shieldai.demo domain is
// reserved for the sandbox so a demo account can never be mistaken for — or
// collide with — a real one.
const DEMO_EMAIL = DEMO_PERSONAS.client.email;      // demo-client@shieldai.demo
const DEMO_ANALYST_EMAIL = DEMO_PERSONAS.analyst.email; // demo-analyst@shieldai.demo
// Passwords exist only so the records are well-formed; the public gateway
// hands out sessions with no credentials, and the sandbox is read-only.
const DEMO_PASSWORD = "ShieldDemo2026";
const DEMO_COMPANY = "ShieldAI Demo Workspace";

// ── Claude helpers (self-contained so the script doesn't depend on server.js) ──
async function callClaudeText({ system, messages, max_tokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.content?.map(c => c.text || "").join("") || "";
}

function extractJson(text) {
  let clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found");
  let body = clean.slice(start, end + 1);
  try { return JSON.parse(body); }
  catch {
    const repaired = body
      .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    return JSON.parse(repaired);
  }
}

// ── The 3 showcase companies (varied industries & security maturity) ──
const COMPANIES = [
  {
    company: { name: "Meridian Dental Group", industry: "Healthcare", employees: "45" },
    // NIST lens — a dental practice's audience is insurers and HIPAA, who speak CSF.
    frameworkLens: "nist",
    compliance: ["HIPAA"],
    summary: "A multi-location dental practice handling patient health records (PHI) and payment data. Growing fast, modest IT maturity.",
    // Mixed posture — some good controls, notable gaps → "Developing"
    checklist: {
      mfa: "Yes, but only on some accounts (e.g., admin)",
      endpoint: "Built-in protection (Windows Defender, etc.)",
      training: "Yes, occasional/annual training",
      itManagement: "Outsourced IT provider (MSP)",
      dataInventory: "Mostly — we have a general idea",
      priorAudit: "More than 2 years ago",
      documentedPolicies: "A few key policies",
      monitoring: "Some logging, reviewed occasionally",
      emailSecurity: "Built-in filtering (Microsoft 365 / Google Workspace)",
      incidentResponse: "Informal / in our heads only",
      responseSupport: "Internal IT staff",
      backups: "Automated backups, not regularly tested",
      disasterRecovery: "Yes, a basic plan",

      // ── Evidence answers (scoring: false — these don't move the posture
      // score; they're what the frameworks read). Without them the demo shows
      // 410 of 624 controls assessed instead of 597, the Privacy section is
      // empty, and the agent has nothing to corroborate against — which is the
      // differentiator.
      //
      // Profile: a dental practice with a decent MSP and genuinely weak
      // governance. Encryption on laptops but not the server; no vendor
      // programme; privacy handled by whoever opens the email. This is the
      // shape that produces useful findings rather than a wall of red.
      accessReviews: "Only when someone leaves",
      offboarding: "Within a few days",
      privilegedAccess: "Some people have admin on their normal account",
      passwordPolicy: "Enforced complexity rules, no manager",
      encryptionAtRest: "Full-disk encryption on laptops and servers",
      encryptionInTransit: "HTTPS/TLS on everything public-facing",
      dataRetention: "Informal — we delete things when we notice",
      mediaDisposal: "We wipe or shred, no formal record",
      vendorInventory: "We have a list of vendors",
      vendorDueDiligence: "Only for the largest vendors",
      vendorContracts: "Standard terms, security language in some",
      riskAssessmentCadence: "Only when a customer or insurer asks",
      securityOwnership: "A named individual, informally",
      policyReviewCadence: "Occasionally, when something changes",
      changeManagement: "Informal — people are careful",
      vulnManagement: "Automatic updates enabled, occasional scans",
      physicalSecurity: "Locked doors, keys issued to staff",
      personalDataCategories: "Sensitive categories (health, biometric, precise geolocation, government ID)",
      privacyNotice: "Yes, but it's generic or outdated",
      consumerRights: "Yes, handled manually by whoever gets the email",
      dataSaleSharing: "No — and we've confirmed our ad/analytics tools don't either",
      privacyRequestVolume: "We've never received one",
    },
    policies: ["incident-response", "data-classification"],
  },
  {
    company: { name: "Lakeside Financial Advisors", industry: "Financial Services", employees: "28" },
    // Both — mature enough to pursue certification and answer to multiple parties.
    frameworkLens: "both",
    compliance: ["SEC", "SOC 2"],
    summary: "A boutique wealth-management firm handling client PII and financial data. Security-conscious, well-resourced for its size.",
    // Strong posture → "Moderate"/"Strong"
    checklist: {
      mfa: "Yes, required on all accounts",
      endpoint: "Advanced EDR (CrowdStrike, SentinelOne, etc.)",
      training: "Yes, regular training + phishing simulations",
      itManagement: "Dedicated in-house IT/security staff",
      dataInventory: "Yes, fully documented inventory",
      priorAudit: "Within the last year (or formally certified)",
      documentedPolicies: "Yes, a full set of documented policies",
      monitoring: "Yes, active monitoring (SIEM/SOC or managed)",
      emailSecurity: "Advanced email security (Proofpoint, Mimecast, etc.)",
      incidentResponse: "Yes, documented and tested",
      responseSupport: "Retained security firm / MSP on call",
      backups: "Automated, offsite/cloud backups (tested)",
      disasterRecovery: "Yes, documented with recovery time goals",

      // Evidence answers. Profile: mature for 28 people — in-house IT, real
      // vendor programme, SOC 2 in progress. Deliberately NOT perfect: no
      // in-house password manager and a retention policy that isn't enforced.
      // A demo where everything is green teaches a prospect nothing and reads
      // as a mock-up.
      accessReviews: "Formal reviews at least quarterly, documented",
      offboarding: "Same day, via a documented checklist",
      privilegedAccess: "Separate admin accounts, MFA, access logged and time-limited",
      passwordPolicy: "Enforced complexity rules, no manager",
      encryptionAtRest: "Yes — full-disk plus database/file encryption, keys managed",
      encryptionInTransit: "TLS everywhere, enforced and monitored for weak ciphers",
      dataRetention: "Documented but not consistently enforced",
      mediaDisposal: "Certified destruction/wiping with documented chain of custody",
      vendorInventory: "Documented inventory with data types and contracts",
      vendorDueDiligence: "Yes — questionnaire or SOC 2 review, documented, periodic re-review",
      vendorContracts: "Yes — security terms plus DPAs/BAAs where required",
      riskAssessmentCadence: "At least annually, documented, with tracked remediation",
      securityOwnership: "A named individual with documented authority and budget",
      policyReviewCadence: "At least annually, with documented management approval",
      changeManagement: "Documented approval, testing, and rollback for every change",
      vulnManagement: "Regular scanning with tracked remediation SLAs",
      physicalSecurity: "Badge access with logging, visitors escorted, cloud-hosted infra",
      personalDataCategories: "Standard identifiers plus commercial/behavioral data",
      privacyNotice: "Yes — categories, purposes, rights, and updated in the last 12 months",
      consumerRights: "Yes — a defined intake channel, identity verification, tracked to a deadline",
      dataSaleSharing: "No — and we've confirmed our ad/analytics tools don't either",
      privacyRequestVolume: "Yes — logged with dates, outcomes, and metrics we could report",
    },
    policies: ["access-control", "vendor-risk"],
  },
  {
    company: { name: "Apex Manufacturing", industry: "Manufacturing", employees: "120" },
    // CIS lens — a manufacturer chasing contracts wants a concrete roadmap, not theory.
    frameworkLens: "cis",
    compliance: ["CMMC"],
    summary: "A mid-size manufacturer pursuing defense contracts (CMMC required). Operational focus, security maturity lagging behind growth.",
    // Weak posture → "At Risk"
    checklist: {
      mfa: "No, but planning to add it",
      endpoint: "Basic/free antivirus",
      training: "No training",
      itManagement: "One person handles it part-time",
      dataInventory: "Vague understanding only",
      priorAudit: "Never",
      documentedPolicies: "One or two informal documents",
      monitoring: "Minimal / only what comes built-in",
      emailSecurity: "Basic spam filter only",
      incidentResponse: "No plan",
      responseSupport: "We'd figure it out / call someone",
      backups: "Manual or occasional backups",
      disasterRecovery: "Informal understanding only",

      // Evidence answers. Profile: a manufacturer chasing defense contracts
      // with security maturity well behind its growth. This is the most useful
      // demo of the three — CMMC Level 2 means 110 requirements, and this
      // client meets very few of them. The point isn't the wall of red; it's
      // that the gap list is specific, cited, and ordered.
      //
      // Note physicalSecurity is genuinely good — a factory has controlled
      // access even when its IT doesn't. Real businesses are uneven, and a
      // demo where every answer tracks the posture score looks generated.
      accessReviews: "Never / not sure",
      offboarding: "Accounts often stay active / not sure",
      privilegedAccess: "Most users are local admins / not sure",
      passwordPolicy: "No policy / shared passwords in use",
      encryptionAtRest: "Some systems only",
      encryptionInTransit: "Mostly, but some internal traffic is plaintext",
      dataRetention: "We keep everything indefinitely / not sure",
      mediaDisposal: "Devices get reused or sit in a closet",
      vendorInventory: "We could reconstruct it if asked",
      vendorDueDiligence: "No / not sure",
      vendorContracts: "Rarely — we sign their paper",
      riskAssessmentCadence: "Never",
      securityOwnership: "Shared across leadership — no single owner",
      policyReviewCadence: "Written once, never revisited",
      changeManagement: "Informal — people are careful",
      vulnManagement: "We patch when something breaks or makes the news",
      physicalSecurity: "Badge access with logging, visitors escorted, cloud-hosted infra",
      personalDataCategories: "None — we're B2B and hold no consumer data",
      privacyNotice: "A short blurb in our terms",
      consumerRights: "We'd honor a request but have no process",
      dataSaleSharing: "Not sure",
      privacyRequestVolume: "We've never received one",
    },
    policies: ["incident-response", "backup-recovery"],
  },
];

// ── Hardcoded fallback content for each pipeline section ──
// Used only if the live AI call fails, so the demo is never broken.
function fallbackSection(key, company, posture) {
  const name = company.company.name;
  const ind = company.company.industry;
  switch (key) {
    case "riskOverview":
      return {
        postureScore: posture.postureScore,
        postureLevel: posture.postureLevel,
        executiveSummary: `${name} currently maintains a ${posture.postureLevel.toLowerCase()} security posture, scoring ${posture.postureScore}/100 under the NIST Cybersecurity Framework. The most significant gaps are in ${posture.weakestAreas.join(" and ")}, which should be prioritized. Addressing these areas will materially reduce the organization's exposure to the most common threats facing the ${ind.toLowerCase()} sector.`,
        topThreats: [
          { threat: "Phishing & Business Email Compromise", likelihood: "High", impact: "High", description: `Email-based attacks remain the leading entry point for breaches in ${ind.toLowerCase()} organizations.` },
          { threat: "Ransomware", likelihood: "Medium", impact: "High", description: "Encryption of critical systems and data could halt operations and trigger costly recovery." },
          { threat: "Unauthorized Data Access", likelihood: "Medium", impact: "High", description: "Weak access controls increase the risk of sensitive data exposure." },
        ],
        breakdown: {
          methodology: posture.methodology,
          functions: posture.functions,
          weakestAreas: posture.weakestAreas,
          complianceNote: posture.complianceNote,
        },
      };
    case "priorities":
      return {
        priorities: [
          { id: "P1", rank: 1, title: "Enforce Multi-Factor Authentication Everywhere", description: "Require MFA on all email, remote access, and administrative accounts.", effort: "Quick Win", impact: "High", category: "Identity", owner: "IT", estimatedCost: "<$500" },
          { id: "P2", rank: 2, title: "Formalize & Test an Incident Response Plan", description: "Document a written IR plan with defined roles and run a tabletop exercise.", effort: "30 Days", impact: "High", category: "Awareness", owner: "Leadership", estimatedCost: "$500-2k" },
          { id: "P3", rank: 3, title: "Implement Tested, Offsite Backups", description: "Move to automated offsite backups and validate restores quarterly.", effort: "30 Days", impact: "High", category: "Data", owner: "IT", estimatedCost: "$500-2k" },
          { id: "P4", rank: 4, title: "Deploy Security Awareness Training", description: "Roll out recurring training with simulated phishing campaigns.", effort: "90 Days", impact: "Medium", category: "Awareness", owner: "All Staff", estimatedCost: "$500-2k" },
        ],
        quickWins: [
          { action: "Turn on MFA for email and remote access", benefit: "Blocks the majority of account-takeover attacks", howTo: "Enable MFA in your Microsoft 365 / Google Workspace admin console." },
          { action: "Enable automatic security updates", benefit: "Closes known vulnerabilities attackers exploit", howTo: "Turn on automatic OS and application patching on all devices." },
          { action: "Review and remove unused user accounts", benefit: "Shrinks the attack surface immediately", howTo: "Audit your user directory and disable departed-employee accounts." },
        ],
      };
    case "policiesCore":
      return { policies: [
        { id: "POL1", name: "Acceptable Use Policy", purpose: "Defines appropriate use of company systems and data.", scope: "All employees and contractors.", policyText: "Company systems are provided for business purposes. Users must protect credentials, avoid unauthorized software, and report suspected security incidents promptly. Misuse may result in disciplinary action.", procedures: ["Acknowledge policy at onboarding", "Review annually", "Report violations to IT"], reviewCycle: "Annual", owner: "IT" },
        { id: "POL2", name: "Password & Authentication Policy", purpose: "Sets standards for strong authentication.", scope: "All accounts and systems.", policyText: "All accounts must use strong, unique passwords of at least 12 characters and enable multi-factor authentication where supported. Passwords must not be shared or reused across systems.", procedures: ["Enforce via identity provider", "Require MFA enrollment", "Audit quarterly"], reviewCycle: "Annual", owner: "IT" },
        { id: "POL3", name: "Data Protection Policy", purpose: "Protects sensitive and regulated data.", scope: "All sensitive data the company handles.", policyText: "Sensitive data must be classified, encrypted in transit and at rest, and accessible only to authorized personnel on a need-to-know basis. Data handling must comply with applicable regulations.", procedures: ["Classify data assets", "Apply encryption", "Restrict access by role"], reviewCycle: "Annual", owner: "Leadership" },
      ]};
    case "policiesOps":
      return { policies: [
        { id: "POL4", name: "Incident Response Policy", purpose: "Ensures a coordinated response to security incidents.", scope: "All staff and systems.", policyText: "Suspected security incidents must be reported immediately to the designated incident lead. The organization will contain, investigate, remediate, and document each incident, and notify affected parties as required by law.", procedures: ["Detect and report", "Contain and investigate", "Remediate and review"], reviewCycle: "Semi-Annual", owner: "IT" },
        { id: "POL5", name: "Backup & Recovery Policy", purpose: "Ensures critical data can be restored.", scope: "All critical systems and data.", policyText: "Critical data must be backed up automatically to offsite/cloud storage daily, with restores tested at least quarterly. Recovery objectives must be defined and reviewed annually.", procedures: ["Automate daily backups", "Store offsite", "Test restores quarterly"], reviewCycle: "Annual", owner: "IT" },
        { id: "POL6", name: "Access Control Policy", purpose: "Governs who can access what.", scope: "All systems and data.", policyText: "Access is granted on a least-privilege, role-based basis. Access is reviewed quarterly and revoked promptly upon role change or departure.", procedures: ["Assign by role", "Review quarterly", "Revoke on offboarding"], reviewCycle: "Quarterly", owner: "IT" },
      ]};
    case "compliance":
      return { frameworks: (company.compliance || ["NIST CSF"]).map(fw => ({
        name: fw, applicability: "Required", overallScore: posture.postureScore,
        certificationPath: `Close the identified control gaps, then pursue formal ${fw} validation.`,
        gaps: [
          { control: "Access Control", status: posture.postureScore > 60 ? "Partial" : "Missing", remediation: "Implement role-based access and quarterly reviews.", priority: "High" },
          { control: "Incident Response", status: "Partial", remediation: "Document and test a formal IR plan.", priority: "High" },
          { control: "Audit & Monitoring", status: posture.postureScore > 60 ? "Partial" : "Missing", remediation: "Enable centralized logging and review.", priority: "Medium" },
        ],
      }))};
    case "workflows":
      return { workflows: [
        { id: "WF1", name: "Phishing Incident Response", category: "Incident Response", trigger: "An employee reports or clicks a suspicious email.", severity: "High",
          steps: [
            { step: 1, action: "Isolate the affected account and reset credentials.", responsible: "IT", timeframe: "Within 1 hour", tools: "Identity provider" },
            { step: 2, action: "Investigate scope and check for data access.", responsible: "IT", timeframe: "Within 4 hours", tools: "Email logs" },
            { step: 3, action: "Notify leadership and document the incident.", responsible: "Leadership", timeframe: "Same day", tools: "IR log" },
          ],
          escalationPath: ["IT Lead", "Management", "External Security Firm"], successCriteria: "Threat contained, no data loss confirmed, lessons documented." },
      ]};
    case "threatIntel":
      return { threatLandscape: {
        industryThreats: [
          { name: "Ransomware targeting " + ind, description: `${ind} organizations are frequent ransomware targets due to operational sensitivity.`, prevalence: "High", mitigations: ["Tested offsite backups", "Endpoint detection & response", "Email filtering"] },
          { name: "Credential Theft", description: "Stolen credentials are widely used to access business systems.", prevalence: "High", mitigations: ["Enforce MFA", "Security awareness training"] },
        ],
        recentCVEs: [],
        darkWebMentions: "No intel",
      }};
    case "tools":
      return { toolStack: [
        { category: "Identity", subcategory: "MFA", recommended: "Microsoft Entra ID / Duo", alternative: "Google Workspace MFA", rationale: "Blocks account-takeover attacks.", cost: "<$50/mo", implementation: "Easy" },
        { category: "Endpoint", subcategory: "EDR", recommended: "SentinelOne / CrowdStrike", alternative: "Microsoft Defender for Business", rationale: "Detects and contains endpoint threats.", cost: "$50-200/mo", implementation: "Moderate" },
        { category: "Email", subcategory: "Filtering", recommended: "Proofpoint Essentials", alternative: "Microsoft 365 Defender", rationale: "Stops phishing before it reaches inboxes.", cost: "$50-200/mo", implementation: "Easy" },
        { category: "Backup", subcategory: "Cloud Backup", recommended: "Datto / Veeam", alternative: "Backblaze", rationale: "Ensures recoverability after ransomware.", cost: "$50-200/mo", implementation: "Moderate" },
      ]};
    case "training":
      return { trainingProgram: {
        modules: [
          { id: "MOD1", title: "Phishing & Email Safety", audience: "All Staff", duration: "30 min", topics: ["Recognizing phishing", "Reporting suspicious email", "Safe link practices"], keyTakeaways: ["Never click unverified links", "Report suspicious email immediately", "Verify unusual requests"], quiz: [{ question: "What should you do with a suspicious email?", options: ["Delete it silently", "Report it to IT", "Forward to colleagues", "Reply to ask"], correct: 1 }] },
          { id: "MOD2", title: "Password & Account Security", audience: "All Staff", duration: "15 min", topics: ["Strong passwords", "MFA", "Credential hygiene"], keyTakeaways: ["Use a password manager", "Enable MFA everywhere", "Never reuse passwords"], quiz: [{ question: "What makes a password strong?", options: ["Your birthday", "Length and uniqueness", "A single word", "Your pet's name"], correct: 1 }] },
        ],
        phishingSimulation: { frequency: "Monthly", scenarios: ["Fake invoice from vendor", "IT password-reset request"] },
      }};
    case "execReport":
      return { executiveReport: {
        headline: `${name} has a ${posture.postureLevel.toLowerCase()} security posture with clear, achievable priorities for improvement.`,
        securityPosture: `The organization scores ${posture.postureScore}/100 under the NIST CSF. Strengths and gaps are well understood, with the largest gaps in ${posture.weakestAreas.join(" and ")}.`,
        businessRisk: `Without action, the business faces elevated risk of phishing, ransomware, and data exposure. The recommended roadmap materially reduces this exposure within 90 days.`,
        investmentRequired: "$2k-10k",
        roi: "A modest investment in core controls avoids potentially business-ending breach and downtime costs.",
        keyFindings: [
          `Posture is ${posture.postureLevel} (${posture.postureScore}/100).`,
          `Weakest areas: ${posture.weakestAreas.join(", ")}.`,
          "Several high-impact quick wins are available immediately.",
        ],
        nextSteps: [
          { action: "Enable MFA on all accounts", owner: "IT", dueDate: "30 days", priority: "High" },
          { action: "Document and test an incident response plan", owner: "Leadership", dueDate: "60 days", priority: "High" },
          { action: "Implement tested offsite backups", owner: "IT", dueDate: "60 days", priority: "High" },
        ],
      }};
    default:
      return null;
  }
}

// ── Generate one program (real AI, fallback per failed section) ──
async function generateProgram(userId, assessmentId, companyData) {
  const ctx = JSON.stringify(companyData, null, 2);
  const posture = computePostureScore(companyData);
  const sections = {};

  for (const step of PIPELINE) {
    process.stdout.write(`    · ${step.key}… `);
    try {
      if (step.key === "riskOverview") {
        const summary = `COMPUTED POSTURE (authoritative): score ${posture.postureScore}/100 (${posture.postureLevel}); per-function ${posture.functions.map(f => `${f.name} ${f.score}`).join(", ")}; weakest ${posture.weakestAreas.join(", ")}.`;
        const system = `You are a senior CISO. A deterministic engine computed this score; do NOT change it. Return ONLY valid JSON: {"postureScore":${posture.postureScore},"postureLevel":"${posture.postureLevel}","executiveSummary":"3-4 sentences","topThreats":[{"threat":"","likelihood":"High|Medium|Low","impact":"High|Medium|Low","description":""}]} with exactly 3 threats.`;
        const text = await callClaudeText({ system, messages: [{ role: "user", content: `Business:\n${ctx}\n\n${summary}` }], max_tokens: step.maxTokens });
        const r = extractJson(text);
        r.postureScore = posture.postureScore;
        r.postureLevel = posture.postureLevel;
        r.breakdown = { methodology: posture.methodology, functions: posture.functions, weakestAreas: posture.weakestAreas, complianceNote: posture.complianceNote };
        sections[step.key] = r;
      } else {
        const text = await callClaudeText({
          system: step.system,
          messages: [{ role: "user", content: `Business context:\n${ctx}\n\nGenerate the "${step.key}" section. Return ONLY valid JSON matching the schema.` }],
          max_tokens: step.maxTokens,
        });
        sections[step.key] = extractJson(text);
      }
      console.log("ok");
    } catch (err) {
      const fb = fallbackSection(step.key, companyData, posture);
      sections[step.key] = fb;
      console.log(`fallback (${err.message.slice(0, 40)})`);
    }
  }

  const program = {
    id: randomUUID(),
    userId,
    assessmentId,
    createdAt: new Date().toISOString(),
    status: "complete",
    sections,
  };
  db.data.programs.push(program);
  return program;
}

// ── Generate a professional policy doc (real AI, fallback to a stub) ──
async function generatePolicy(userId, policyId, companyData) {
  const def = POLICY_CATALOG.find(p => p.id === policyId);
  if (!def) return;
  const today = new Date().toISOString().slice(0, 10);
  const structure = buildStructurePrompt(policyId);
  const system = `You are a senior CISO writing a professional ${def.name}. Begin with a header block (# Title, **Policy Owner**, **Effective Date:** ${today}, **Version:** 1.0, **Applies To**), then these sections as ## headers:\n${structure}\nUse markdown, a Revision History table, and tailor to the business. Output only the document.`;
  let content;
  try {
    content = (await callClaudeText({
      system,
      messages: [{ role: "user", content: `Generate the ${def.name} for ${companyData.company.name} (${companyData.company.industry}, ${companyData.company.employees} employees).` }],
      max_tokens: 4000,
    })).trim();
  } catch {
    content = `# ${def.name}\n\n**Policy Owner:** IT Manager\n**Effective Date:** ${today}\n**Version:** 1.0\n**Applies To:** All employees of ${companyData.company.name}\n\n---\n\n## 1. Purpose\nThis policy establishes requirements to protect ${companyData.company.name}'s systems and data.\n\n## 2. Scope\nApplies to all employees, contractors, and systems.\n\n## 3. Policy Statements\nThe organization will implement and maintain appropriate controls consistent with industry best practice and applicable regulations.\n\n## 4. Revision History\n| Version | Date | Description |\n|---|---|---|\n| 1.0 | ${today} | Initial release |`;
  }
  const record = {
    id: randomUUID(), userId, policyId, policyName: def.name,
    createdAt: new Date().toISOString(),
    companyContext: companyData.company, answers: {}, content,
  };
  db.data.policyDocs.push(record);
  console.log(`    · policy: ${def.name}`);
  return record;
}

// ── Small helpers for the feature-area fixtures below ──────────
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS).toISOString();
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const newLearnerToken = () => randomBytes(24).toString("base64url");

// ── Endpoint monitoring fleet, per company ──────────────────────
// Check statuses are deliberately tied to each company's own checklist
// answers so the "agent vs. questionnaire" corroboration feature has real
// material: Meridian's findings CONFIRM what they reported (decent MSP,
// weak governance); Apex's disk_encryption findings deliberately DISPUTE
// their own "some systems" answer — the agent found none — which is the
// single most useful demo moment this feature has.
const AGENT_FLEET = {
  "Meridian Dental Group": {
    hosts: [{ hostname: "MERIDIAN-WKS-04", os: "windows" }, { hostname: "MERIDIAN-SRV-01", os: "windows" }],
    checks: [
      { id: "av_present", title: "Endpoint protection installed", status: "pass", severity: "info", observed: "Windows Defender active." },
      { id: "av_realtime", title: "Antivirus real-time protection", status: "pass", severity: "info" },
      { id: "av_signatures", title: "Antivirus signature freshness", status: "warn", severity: "medium", observed: "Definitions last updated 11 days ago." },
      { id: "firewall", title: "Host firewall enabled", status: "pass", severity: "info" },
      { id: "disk_encryption", title: "Full-disk encryption", status: "pass", severity: "info", observed: "BitLocker enabled on all volumes." },
      { id: "patches", title: "OS/software patch currency", status: "warn", severity: "medium", observed: "4 pending updates, none critical." },
      { id: "local_admins", title: "Local administrator accounts", status: "fail", severity: "medium", observed: "3 standard users have local admin rights.", cisControl: "5.4" },
      { id: "screen_lock", title: "Automatic screen lock", status: "pass", severity: "info" },
      { id: "guest_account", title: "Guest account disabled", status: "pass", severity: "info" },
      { id: "auto_updates", title: "Automatic security updates", status: "warn", severity: "low", observed: "Manual approval required for updates." },
    ],
    events: [
      { severity: "medium", type: "av_signature_stale", message: "Antivirus definitions on MERIDIAN-WKS-04 are 11 days out of date." },
      { severity: "low", type: "patch_pending", message: "4 pending security updates on MERIDIAN-SRV-01." },
    ],
  },
  "Lakeside Financial Advisors": {
    hosts: [{ hostname: "LAKESIDE-WKS-02", os: "windows" }, { hostname: "LAKESIDE-DC-01", os: "windows" }],
    checks: [
      { id: "av_present", title: "Endpoint protection installed", status: "pass", severity: "info", observed: "CrowdStrike Falcon active." },
      { id: "av_realtime", title: "Antivirus real-time protection", status: "pass", severity: "info" },
      { id: "av_signatures", title: "Antivirus signature freshness", status: "pass", severity: "info" },
      { id: "av_tamper", title: "Antivirus tamper protection", status: "pass", severity: "info" },
      { id: "firewall", title: "Host firewall enabled", status: "pass", severity: "info" },
      { id: "disk_encryption", title: "Full-disk encryption", status: "pass", severity: "info" },
      { id: "patches", title: "OS/software patch currency", status: "warn", severity: "low", observed: "1 optional update pending." },
      { id: "local_admins", title: "Local administrator accounts", status: "pass", severity: "info", observed: "No standard users hold local admin rights." },
      { id: "screen_lock", title: "Automatic screen lock", status: "pass", severity: "info" },
      { id: "guest_account", title: "Guest account disabled", status: "pass", severity: "info" },
      { id: "smb1", title: "Legacy SMBv1 disabled", status: "pass", severity: "info" },
      { id: "rdp_exposure", title: "RDP exposure", status: "pass", severity: "info", observed: "RDP restricted to VPN clients only." },
    ],
    events: [
      { severity: "info", type: "patch_pending", message: "1 optional update pending on LAKESIDE-WKS-02." },
    ],
  },
  "Apex Manufacturing": {
    hosts: [{ hostname: "APEX-SHOPFLOOR-03", os: "windows" }, { hostname: "APEX-OFFICE-01", os: "windows" }],
    checks: [
      { id: "av_present", title: "Endpoint protection installed", status: "fail", severity: "high", observed: "No antivirus product detected." },
      { id: "av_realtime", title: "Antivirus real-time protection", status: "fail", severity: "high" },
      { id: "firewall", title: "Host firewall enabled", status: "fail", severity: "high", observed: "Windows Firewall is disabled on all profiles." },
      { id: "disk_encryption", title: "Full-disk encryption", status: "fail", severity: "critical", observed: "No disk encryption detected on this host." },
      { id: "patches", title: "OS/software patch currency", status: "fail", severity: "high", observed: "14 pending updates; none installed in 60+ days." },
      { id: "local_admins", title: "Local administrator accounts", status: "fail", severity: "high", observed: "All users are local administrators.", cisControl: "5.4" },
      { id: "screen_lock", title: "Automatic screen lock", status: "fail", severity: "medium" },
      { id: "guest_account", title: "Guest account disabled", status: "fail", severity: "medium", observed: "The built-in Guest account is enabled." },
      { id: "smb1", title: "Legacy SMBv1 disabled", status: "fail", severity: "high", observed: "SMBv1 is enabled." },
      { id: "auto_updates", title: "Automatic security updates", status: "fail", severity: "high" },
      { id: "rdp_exposure", title: "RDP exposure", status: "fail", severity: "critical", observed: "RDP is reachable from the internet without Network Level Authentication." },
    ],
    events: [
      { severity: "critical", type: "rdp_exposure", message: "RDP on APEX-SHOPFLOOR-03 is reachable from the internet without NLA." },
      { severity: "high", type: "av_missing", message: "No antivirus product detected on APEX-OFFICE-01." },
      { severity: "high", type: "patch_pending", message: "14 pending security updates on APEX-SHOPFLOOR-03, none installed in 60+ days." },
    ],
  },
};

// ── Main ──
async function main() {
  // Refuse to run if the production store already holds demo identities.
  const prod = getStore(PROD_STORE);
  await prod.read();
  const strays = (prod.data.users || []).filter(u => (u.email || "").endsWith("@shieldai.demo"));
  if (strays.length) {
    throw new Error(
      `Demo accounts found in db.json: ${strays.map(u => u.email).join(", ")}. ` +
      `Remove them before seeding — demo data belongs only in demo-db.json.`
    );
  }

  await db.read();
  db.data.users ||= []; db.data.assessments ||= []; db.data.programs ||= []; db.data.policyDocs ||= [];
  db.data.assignments ||= [];
  // Collections every feature-area route file normally initializes itself at
  // server-registration time (ensureCollections()-style calls in each route
  // module). This script runs standalone — never through server.js — so none
  // of those registrations happen; on a first-ever seed these would otherwise
  // be undefined the moment anything below tries to .push() onto them.
  db.data.tasks ||= []; db.data.evidence ||= []; db.data.postureHistory ||= [];
  db.data.learners ||= []; db.data.trainingAssignments ||= []; db.data.trainingQuarters ||= [];
  db.data.moduleContent ||= []; db.data.phishingCampaigns ||= []; db.data.phishingResults ||= [];
  db.data.policyAcknowledgments ||= []; db.data.complianceCalendarEntries ||= [];
  db.data.clientMessages ||= []; db.data.postureSnapshots ||= []; db.data.branding ||= [];

  // ── Demo analyst (sees only the demo clients, in the demo store) ──
  let analyst = db.data.users.find(u => u.email === DEMO_ANALYST_EMAIL);
  if (!analyst) {
    analyst = {
      id: randomUUID(), email: DEMO_ANALYST_EMAIL, companyName: "ShieldAI Demo Analyst",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      isAdmin: false, isAnalyst: true, isDemo: true, tier: "managed",
      createdAt: new Date().toISOString(),
    };
    db.data.users.push(analyst);
    console.log(`Created demo analyst: ${DEMO_ANALYST_EMAIL}`);
  }

  // Find or create the demo user
  let user = db.data.users.find(u => u.email === DEMO_EMAIL);
  if (user) {
    console.log("Removing previous demo data…");
    db.data.assessments = db.data.assessments.filter(a => a.userId !== user.id);
    db.data.programs = db.data.programs.filter(p => p.userId !== user.id);
    db.data.policyDocs = db.data.policyDocs.filter(p => p.userId !== user.id);
    // Everything added since this script last grew: purge for the demo client
    // (and, where the collection is analyst-owned, the demo analyst) so
    // re-running stays safe/idempotent rather than accumulating duplicates.
    db.data.agents = (db.data.agents || []).filter(a => a.ownerUserId !== user.id);
    db.data.enrollTokens = (db.data.enrollTokens || []).filter(t => t.ownerUserId !== user.id);
    db.data.agentReports = (db.data.agentReports || []).filter(r => r.ownerUserId !== user.id);
    db.data.agentEvents = (db.data.agentEvents || []).filter(e => e.ownerUserId !== user.id);
    db.data.recommendations = (db.data.recommendations || []).filter(r => r.ownerUserId !== user.id);
    db.data.tasks = (db.data.tasks || []).filter(t => t.ownerUserId !== user.id);
    db.data.evidence = (db.data.evidence || []).filter(e => e.ownerUserId !== user.id);
    db.data.postureHistory = (db.data.postureHistory || []).filter(h => h.userId !== user.id);
    db.data.vendors = (db.data.vendors || []).filter(v => v.userId !== user.id);
    db.data.vendorQuestionnaires = (db.data.vendorQuestionnaires || []).filter(q => q.userId !== user.id);
    db.data.learners = (db.data.learners || []).filter(l => l.clientUserId !== user.id);
    db.data.trainingAssignments = (db.data.trainingAssignments || []).filter(a => a.clientUserId !== user.id);
    db.data.trainingQuarters = (db.data.trainingQuarters || []).filter(q => q.clientUserId !== user.id);
    db.data.moduleContent = (db.data.moduleContent || []).filter(m => m.clientUserId !== user.id);
    db.data.phishingCampaigns = (db.data.phishingCampaigns || []).filter(c => c.clientUserId !== user.id);
    db.data.phishingResults = (db.data.phishingResults || []).filter(r => {
      const stillReferenced = (db.data.phishingCampaigns || []).some(c => c.id === r.campaignId);
      return stillReferenced;
    });
    db.data.policyAcknowledgments = (db.data.policyAcknowledgments || []).filter(a => a.clientUserId !== user.id);
    db.data.complianceCalendarEntries = (db.data.complianceCalendarEntries || []).filter(e => e.userId !== user.id);
    db.data.notifications = (db.data.notifications || []).filter(n => n.userId !== user.id);
    db.data.clientMessages = (db.data.clientMessages || []).filter(m => m.clientUserId !== user.id);
    db.data.postureSnapshots = (db.data.postureSnapshots || []).filter(s => s.userId !== user.id);
    if (db.data.cveExposure) delete db.data.cveExposure[user.id];
    if (db.data.darkwebExposure) delete db.data.darkwebExposure[user.id];
    db.data.branding = (db.data.branding || []).filter(b => b.ownerUserId !== analyst.id);
  } else {
    user = {
      id: randomUUID(), email: DEMO_EMAIL, companyName: DEMO_COMPANY,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      isAdmin: false, isAnalyst: false, isDemo: true, tier: "managed",
      createdAt: new Date().toISOString(),
    };
    db.data.users.push(user);
    console.log(`Created demo client: ${DEMO_EMAIL}`);
  }
  user.isDemo = true;

  // Assign the demo client to the demo analyst so the analyst console has
  // scoped data — same isolation rules as production, just sandboxed.
  db.data.assignments = db.data.assignments.filter(a => a.analystUserId !== analyst.id);
  db.data.assignments.push({
    id: randomUUID(), analystUserId: analyst.id, clientUserId: user.id,
    assignedBy: analyst.id, assignedAt: new Date().toISOString(),
  });

  // Per-company references captured for the feature-area seeding below —
  // evidence/vendors/policy-acknowledgment/etc. all need to point at a real
  // assessment id or a real generated policyDoc, not an invented one.
  const byCompany = {}; // companyName -> { assessment, program, policies: [...] }

  for (const co of COMPANIES) {
    console.log(`\n▶ ${co.company.name} (${co.company.industry})`);
    const assessment = {
      id: randomUUID(), userId: user.id, createdAt: new Date().toISOString(),
      data: { company: co.company, compliance: co.compliance, summary: co.summary, checklist: co.checklist },
    };
    db.data.assessments.push(assessment);

    const program = await generateProgram(user.id, assessment.id, assessment.data);
    const policies = [];
    for (const pid of (co.policies || [])) {
      const rec = await generatePolicy(user.id, pid, assessment.data);
      if (rec) policies.push(rec);
    }
    byCompany[co.company.name] = { assessment, program, policies };
    await db.write(); // save progress after each company
  }

  // Give the demo client a fully-verified domain record so the breach-monitoring
  // card shows the finished state rather than an empty form. The workflow itself
  // stays fully clickable inside each visitor's sandbox.
  // Keyed by DEMO_COMPANY (the account's own companyName), matching the single
  // DEMO_BREACHES entry in demoIntel.js — there's one demo account, not three,
  // so the domain/breach story reflects one company (Lakeside Financial
  // Advisors) rather than falling back to the generic example.example default.
  db.data.clientDomains ||= [];
  db.data.clientDomains = db.data.clientDomains.filter(d => d.userId !== user.id);
  db.data.clientDomains.push(demoDomainRecord(user.id, DEMO_COMPANY));

  // ── Endpoint monitoring fleet ──────────────────────────────────
  console.log("\n▶ Endpoint monitoring fleet");
  const agentsByCompany = {};
  const reportsByAgent = {};
  for (const [companyName, fleet] of Object.entries(AGENT_FLEET)) {
    const agentList = [];
    for (const host of fleet.hosts) {
      const agent = {
        id: randomUUID(), ownerUserId: user.id, hostname: host.hostname, os: host.os,
        tokenHash: sha256hex(randomUUID()), status: "active",
        createdAt: daysAgo(120), lastSeen: daysAgo(0), revokedAt: null, agentVersion: "1.1.0",
      };
      db.data.agents.push(agent);
      agentList.push(agent);

      const reportBody = {
        checks: fleet.checks,
        host: { hostname: host.hostname, os: host.os, osVersion: "10.0.19045" },
        inventory: { software: [] },
        agentVersion: "1.1.0",
      };
      const summary = summarizeReport(reportBody);
      const report = { id: randomUUID(), agentId: agent.id, ownerUserId: user.id, receivedAt: daysAgo(0), report: reportBody };
      db.data.agentReports.push(report);
      reportsByAgent[agent.id] = report;
      console.log(`    · ${host.hostname}: ${summary.posture} (${summary.failCount} fail / ${summary.warnCount} warn)`);
    }
    agentsByCompany[companyName] = agentList;

    fleet.events.forEach((e, i) => {
      db.data.agentEvents.push({
        id: randomUUID(), agentId: agentList[0].id, ownerUserId: user.id, ts: daysAgo(i + 1),
        source: "agent", severity: e.severity, type: e.type, message: e.message, raw: null, ack: false,
      });
    });
  }
  const totalEndpoints = Object.values(agentsByCompany).flat().length;
  console.log(`   ${totalEndpoints} endpoints across ${Object.keys(agentsByCompany).length} companies`);

  // ── Recommendations lifecycle ───────────────────────────────────
  console.log("\n▶ Recommendations lifecycle");
  const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const allDrafts = [];
  for (const [companyName, agentList] of Object.entries(agentsByCompany)) {
    for (const agent of agentList) {
      const report = reportsByAgent[agent.id];
      for (const d of buildDraftsFromReport({ report: report.report, agent })) {
        allDrafts.push({ ...d, companyName });
      }
    }
  }
  allDrafts.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
  // Cap to a readable queue — up to 4 per company rather than every finding.
  const perCompanyCount = {};
  const chosenDrafts = allDrafts.filter(d => (perCompanyCount[d.companyName] = (perCompanyCount[d.companyName] || 0) + 1) <= 4);

  function pushHist(rec, actorType, actorId, status, note, at) {
    rec.history.push({ at, actorType, actorId: actorId || null, status, note: note || "" });
    rec.status = status;
  }
  // One entry per chosen draft, index-mapped to a lifecycle stage so the
  // queue shows every real stage at once, not just "everything is done".
  const LIFECYCLE_STAGES = ["suggested", "suggested", "proposed", "proposed", "permitted", "client_performing", "declined", "completed", "completed"];
  chosenDrafts.forEach((d, i) => {
    const rec = {
      id: randomUUID(), ownerUserId: user.id, agentId: d.agentId, dedupeKey: d.dedupeKey, checkId: d.checkId,
      origin: "ai", aiAuthored: true, title: d.title, detail: d.detail, severity: d.severity,
      priority: Math.max(1, 5 - (SEV_RANK[d.severity] ?? 0)),
      rationale: `Flagged from ${d.companyName}'s latest endpoint report.`,
      status: "suggested", createdAt: daysAgo(10), history: [],
    };
    pushHist(rec, "ai", null, "suggested", "Auto-drafted by Mastermind AI from agent report.", daysAgo(10));

    const target = LIFECYCLE_STAGES[i] || "suggested";
    if (target !== "suggested") {
      pushHist(rec, "analyst", analyst.id, "proposed", "Forwarded to client.", daysAgo(8));
      if (target === "permitted" || target === "completed") {
        pushHist(rec, "client_admin", user.id, "permitted", "Go ahead and take care of this.", daysAgo(6));
      } else if (target === "client_performing") {
        pushHist(rec, "client_admin", user.id, "client_performing", "We'll handle this ourselves.", daysAgo(6));
      } else if (target === "declined") {
        pushHist(rec, "client_admin", user.id, "declined", "Deferring for now — next budget cycle.", daysAgo(6));
      }
      if (target === "completed") {
        pushHist(rec, "analyst", analyst.id, "completed", "Resolved during the last maintenance window.", daysAgo(2));
      }
    }
    db.data.recommendations.push(rec);
  });
  console.log(`   ${chosenDrafts.length} recommendations spanning the full lifecycle`);

  // ── Remediation tasks ────────────────────────────────────────────
  // Tasks are user-level, not per-assessment — taskRoutes.js's
  // latestAssessmentFor() always resolves to whichever assessment was
  // created/updated most recently, which is Apex Manufacturing's (seeded
  // last, and also the weakest posture — the most genuine gaps to open
  // tasks against).
  console.log("\n▶ Remediation tasks");
  const apexAssessment = byCompany["Apex Manufacturing"].assessment;
  const bestOptionFor = (control) => [...control.options].sort((a, b) => b.score - a.score)[0];
  const TASK_PLAN = [
    { controlId: "mfa", priority: "critical", status: "open", dueDays: 14 },
    { controlId: "backups", priority: "high", status: "open", dueDays: 21 },
    { controlId: "monitoring", priority: "high", status: "in_progress", dueDays: 30 },
    { controlId: "incidentResponse", priority: "high", status: "open", dueDays: 30 },
    { controlId: "documentedPolicies", priority: "medium", status: "done" },
    { controlId: "priorAudit", priority: "medium", status: "done" },
  ];
  const seededTasks = [];
  for (const spec of TASK_PLAN) {
    const control = getControl(spec.controlId);
    if (!control) continue;
    const best = bestOptionFor(control);
    const sim = simulateControlChange(db, user.id, spec.controlId, best.label);
    const task = {
      id: randomUUID(), ownerUserId: user.id, controlId: spec.controlId, targetLabel: best.label,
      title: `Improve: ${control.question}`, detail: "", nistFunction: control.nistFunction,
      status: "open", priority: spec.priority, effort: null,
      dueDate: spec.dueDays != null ? daysFromNow(spec.dueDays) : null,
      assigneeUserId: null, createdBy: analyst.id,
      createdAt: daysAgo(20), updatedAt: daysAgo(20), completedAt: null,
      projectedGain: sim ? sim.delta : null, scoreAtCreate: sim ? sim.current : null,
      evidence: [], history: [],
    };
    task.history.push({ at: daysAgo(20), actorType: "analyst", actorId: analyst.id, action: "created",
      note: sim ? `Projected +${sim.delta} posture.` : "" });

    if (spec.status === "in_progress") {
      task.status = "in_progress";
      task.updatedAt = daysAgo(10);
      task.history.push({ at: daysAgo(10), actorType: "client", actorId: user.id, action: "status", note: "open → in_progress" });
    } else if (spec.status === "done") {
      // Mirror the REAL completion path (taskRoutes.js's /complete): write the
      // target label into the assessment checklist and record a real
      // postureHistory point, so the task and the assessment never disagree.
      const before = computePostureScore(apexAssessment.data);
      apexAssessment.data.checklist = { ...apexAssessment.data.checklist, [spec.controlId]: best.label };
      apexAssessment.updatedAt = new Date().toISOString(); // keeps Apex "latest" for latestAssessmentFor()
      const after = computePostureScore(apexAssessment.data);
      task.status = "done";
      task.completedAt = daysAgo(3);
      task.updatedAt = daysAgo(3);
      task.actualGain = after.postureScore - before.postureScore;
      task.scoreAtComplete = after.postureScore;
      task.history.push({ at: daysAgo(3), actorType: "client", actorId: user.id, action: "completed",
        note: `Posture ${before.postureScore} → ${after.postureScore} (${task.actualGain >= 0 ? "+" : ""}${task.actualGain}).` });
      db.data.postureHistory ||= [];
      db.data.postureHistory.push({ id: randomUUID(), userId: user.id, at: daysAgo(3), score: after.postureScore, level: after.postureLevel, reason: `task:${task.id}` });
    }
    db.data.tasks.push(task);
    seededTasks.push(task);
  }
  console.log(`   ${seededTasks.length} tasks (${seededTasks.filter(t => t.status === "done").length} completed)`);

  // ── Evidence ─────────────────────────────────────────────────────
  console.log("\n▶ Evidence");
  let evidenceCount = 0;
  for (const t of seededTasks.filter(t => t.status === "done")) {
    const ev = {
      id: randomUUID(), ownerUserId: user.id, kind: "task", refId: t.id,
      title: `Confirmation — ${t.title.replace(/^Improve:\s*/, "")}`,
      note: "Verified complete during the scheduled remediation review; no supporting file attached.",
      filename: null, mimeType: null, bytes: 0, sha256: null, storagePath: null,
      uploadedBy: analyst.id, uploadedAt: t.completedAt,
    };
    db.data.evidence.push(ev);
    t.evidence.push({ id: ev.id, title: ev.title, filename: null, at: ev.uploadedAt });
    evidenceCount++;
  }
  db.data.evidence.push(
    { id: randomUUID(), ownerUserId: user.id, kind: "general", refId: null,
      title: "Cyber liability insurance policy — 2026 renewal",
      note: "Confirmed active with underwriter; policy document held by leadership, not uploaded here.",
      filename: null, mimeType: null, bytes: 0, sha256: null, storagePath: null,
      uploadedBy: user.id, uploadedAt: daysAgo(30) },
    { id: randomUUID(), ownerUserId: user.id, kind: "assessment", refId: apexAssessment.id,
      title: "Signed management attestation — security questionnaire",
      note: "Leadership reviewed and signed off on the submitted assessment answers.",
      filename: null, mimeType: null, bytes: 0, sha256: null, storagePath: null,
      uploadedBy: user.id, uploadedAt: daysAgo(15) },
  );
  evidenceCount += 2;
  console.log(`   ${evidenceCount} evidence records`);

  // ── Vendor risk registry ─────────────────────────────────────────
  console.log("\n▶ Vendor risk registry");
  const VENDOR_PLAN = [
    { name: "Stripe", category: "Payment Processor", criticality: "critical", dataAccessLevel: "limited",
      contactEmail: "support@stripe.example", hasDataAgreement: true, securityCertification: "PCI DSS Level 1",
      lastAssessedAt: daysAgo(60) }, // current
    { name: "Onyx Cloud Hosting", category: "Cloud Hosting/Infrastructure", criticality: "critical", dataAccessLevel: "extensive",
      contactEmail: "security@onyxcloud.example", hasDataAgreement: true, securityCertification: "SOC 2 Type II",
      lastAssessedAt: daysAgo(395) }, // overdue (6mo cadence)
    { name: "Gusto", category: "Payroll/HR", criticality: "high", dataAccessLevel: "extensive",
      contactEmail: "privacy@gusto.example", hasDataAgreement: true, securityCertification: "SOC 2 Type II",
      lastAssessedAt: daysAgo(350) }, // due_soon (12mo cadence)
    { name: "Meridian IT Partners", category: "IT Support/MSP", criticality: "high", dataAccessLevel: "extensive",
      contactEmail: "contracts@meridianitpartners.example", hasDataAgreement: true, securityCertification: "",
      lastAssessedAt: daysAgo(90) }, // current
    { name: "BrightBooks Accounting", category: "SaaS/Software", criticality: "medium", dataAccessLevel: "limited",
      contactEmail: "support@brightbooks.example", hasDataAgreement: false, securityCertification: "",
      contractStartDate: daysAgo(455) }, // overdue, never formally reassessed
  ];
  for (const v of VENDOR_PLAN) createVendor(db, user.id, { ...v, createdByStaff: null });
  console.log(`   ${VENDOR_PLAN.length} vendors`);

  // ── Training delivery (learners, quarters, assignments) ──────────
  console.log("\n▶ Training delivery");
  const LEARNER_PLAN = [
    { name: "Sarah Reyes", email: "sarah.reyes@meridiandental.example", department: "Front Office" },
    { name: "James Okafor", email: "james.okafor@meridiandental.example", department: "Clinical Support" },
    { name: "Priya Nandan", email: "priya.nandan@lakesidefinancial.example", department: "Wealth Management" },
    { name: "Marcus Chen", email: "marcus.chen@lakesidefinancial.example", department: "Compliance" },
    { name: "Derek Holt", email: "derek.holt@apexmfg.example", department: "Production" },
    { name: "Angela Brooks", email: "angela.brooks@apexmfg.example", department: "Operations" },
  ];
  const learners = LEARNER_PLAN.map(l => ({
    id: randomUUID(), clientUserId: user.id, name: l.name, email: l.email, department: l.department,
    token: newLearnerToken(), status: "active", createdAt: daysAgo(150),
  }));
  db.data.learners.push(...learners);

  const q1Topics = DEFAULT_SCHEDULE[0].topicIds; // Month 1: phishing, passwords-mfa, device-security, incident-reporting
  const q1Modules = modulesFromTopics(q1Topics);
  const q1 = {
    id: randomUUID(), clientUserId: user.id, label: "Q1 2026 Training", year: 2026, quarter: 1,
    topicIds: q1Topics, dueDate: daysAgo(30), createdBy: analyst.id, createdAt: daysAgo(90), learnerCount: learners.length,
  };
  db.data.trainingQuarters.push(q1);

  const q2Topics = DEFAULT_SCHEDULE[1].topicIds; // Month 2: bec, payments, data-privacy, acceptable-use
  const q2Modules = modulesFromTopics(q2Topics);
  const q2 = {
    id: randomUUID(), clientUserId: user.id, label: "Q2 2026 Training", year: 2026, quarter: 2,
    topicIds: q2Topics, dueDate: daysFromNow(45), createdBy: analyst.id, createdAt: daysAgo(5), learnerCount: learners.length,
  };
  db.data.trainingQuarters.push(q2);

  // Q1 is past its due date: 4 learners completed everything, 1 is partway
  // (shows as overdue, matching real rollup() behavior for a past-due
  // incomplete assignment), 1 never started (also overdue).
  learners.forEach((learner, i) => {
    const a = {
      id: randomUUID(), clientUserId: user.id, learnerId: learner.id,
      source: "quarterly", quarterId: q1.id, title: q1.label,
      modules: q1Modules, moduleState: {}, status: "assigned", progress: 0, score: null,
      dueDate: q1.dueDate, assignedBy: analyst.id, assignedByRole: "analyst",
      assignedAt: daysAgo(90), startedAt: i < 5 ? daysAgo(85) : null, completedAt: null,
    };
    if (i < 4) {
      q1Modules.forEach((m, mi) => {
        a.moduleState[m.topicId] = { completed: true, score: 80 + ((i * 7 + mi * 3) % 20), completedAt: daysAgo(75 - i) };
      });
    } else if (i === 4) {
      q1Modules.slice(0, 2).forEach(m => { a.moduleState[m.topicId] = { completed: true, score: 88, completedAt: daysAgo(60) }; });
    }
    rollup(a);
    if (a.status === "completed") a.completedAt = daysAgo(70 - i);
    db.data.trainingAssignments.push(a);
  });

  // Q2 isn't due yet — a realistic "just getting started" state.
  learners.forEach((learner, i) => {
    const a = {
      id: randomUUID(), clientUserId: user.id, learnerId: learner.id,
      source: "quarterly", quarterId: q2.id, title: q2.label,
      modules: q2Modules, moduleState: {}, status: "assigned", progress: 0, score: null,
      dueDate: q2.dueDate, assignedBy: analyst.id, assignedByRole: "analyst",
      assignedAt: daysAgo(5), startedAt: null, completedAt: null,
    };
    if (i < 2) {
      a.startedAt = daysAgo(2);
      a.moduleState[q2Modules[0].topicId] = { completed: true, score: 92, completedAt: daysAgo(1) };
    }
    rollup(a);
    db.data.trainingAssignments.push(a);
  });

  // Pre-generate real slide+quiz content for a few modules (the training-depth
  // decision) via the exact same AI path a learner's first click would hit —
  // so at least one module per company opens to real material immediately.
  console.log("   Pre-generating real lesson content for 3 modules…");
  for (const topicId of ["phishing", "passwords-mfa", "bec"]) {
    try {
      await getOrGenerateModuleContent(db, { clientUserId: user.id, topicId, callAI, extractJson });
      console.log(`    · module content: ${topicId}`);
    } catch (err) {
      console.log(`    · module content: ${topicId} — skipped (${err.message.slice(0, 60)})`);
    }
  }
  console.log(`   ${learners.length} learners, 2 quarters, ${learners.length * 2} assignments`);

  // ── Phishing simulation ──────────────────────────────────────────
  console.log("\n▶ Phishing simulation");
  function buildPhishingCampaign({ name, scenarioId, sentDaysAgo, clickedIndexes }) {
    if (!getScenario(scenarioId)) throw new Error(`Unknown phishing scenario: ${scenarioId}`);
    const campaign = {
      id: randomUUID(), clientUserId: user.id, name, scenarioId,
      learnerIds: learners.map(l => l.id), adHocRecipients: [], isTrial: false,
      status: "sent", createdBy: "analyst", createdAt: daysAgo(sentDaysAgo + 1), sentAt: daysAgo(sentDaysAgo),
    };
    db.data.phishingCampaigns.push(campaign);
    learners.forEach((learner, i) => {
      db.data.phishingResults.push({
        id: randomUUID(), campaignId: campaign.id, learnerId: learner.id,
        recipientName: null, recipientEmail: null,
        token: randomUUID().replace(/-/g, ""),
        sentAt: daysAgo(sentDaysAgo), sendError: null,
        clickedAt: clickedIndexes.includes(i) ? daysAgo(sentDaysAgo - 0.2) : null,
      });
    });
    return campaign;
  }
  buildPhishingCampaign({ name: "Q1 Simulation — Password Expiry Notice", scenarioId: "password-expiry", sentDaysAgo: 75, clickedIndexes: [1, 4, 5] });
  buildPhishingCampaign({ name: "Q2 Simulation — Vendor Invoice Overdue", scenarioId: "invoice-overdue", sentDaysAgo: 20, clickedIndexes: [5] });
  console.log("   2 campaigns sent — click rate improved between rounds");

  // ── Policy acknowledgment (reuses the same learner roster) ──────
  console.log("\n▶ Policy acknowledgment");
  const companyLearnerPairs = [
    { company: "Meridian Dental Group", learnerIdxs: [0, 1] },
    { company: "Lakeside Financial Advisors", learnerIdxs: [2, 3] },
    { company: "Apex Manufacturing", learnerIdxs: [4, 5] },
  ];
  let ackCount = 0;
  for (const pair of companyLearnerPairs) {
    for (const policy of byCompany[pair.company].policies) {
      for (const idx of pair.learnerIdxs) {
        const learner = learners[idx];
        const acknowledged = (ackCount % 3) !== 0; // most signed, a few still pending
        db.data.policyAcknowledgments.push({
          id: randomUUID(), clientUserId: user.id,
          policyId: policy.id, policyName: policy.policyName,
          learnerId: learner.id, learnerName: learner.name, learnerEmail: learner.email,
          assignedAt: daysAgo(40), assignedBy: analyst.id, assignedByRole: "analyst",
          remindedAt: acknowledged ? null : daysAgo(5),
          acknowledgedAt: acknowledged ? daysAgo(35) : null,
        });
        ackCount++;
      }
    }
  }
  console.log(`   ${ackCount} policy acknowledgment rows`);

  // ── Compliance calendar ──────────────────────────────────────────
  console.log("\n▶ Compliance calendar");
  db.data.complianceCalendarEntries.push(
    { id: randomUUID(), userId: user.id, title: "Cyber liability insurance renewal", category: "insurance",
      dueDate: daysFromNow(45), recurrenceMonths: 12, notes: "Confirm coverage limits before renewing.",
      completedAt: null, createdAt: daysAgo(10), updatedAt: daysAgo(10), createdByStaff: analyst.id },
    { id: randomUUID(), userId: user.id, title: "State business license renewal", category: "license",
      dueDate: daysFromNow(10), recurrenceMonths: 12, notes: "Apex Manufacturing facility license.",
      completedAt: null, createdAt: daysAgo(10), updatedAt: daysAgo(10), createdByStaff: analyst.id },
    { id: randomUUID(), userId: user.id, title: "SOC 2 Type II surveillance audit", category: "audit",
      dueDate: daysAgo(15), recurrenceMonths: null, notes: "Lakeside Financial Advisors — schedule with auditor.",
      completedAt: null, createdAt: daysAgo(60), updatedAt: daysAgo(60), createdByStaff: analyst.id },
  );
  console.log("   3 compliance calendar entries");

  // ── White-label branding (on the demo analyst, not the client) ──
  console.log("\n▶ White-label branding");
  const brandPatch = validateBrandingPatch({
    productName: "Meridian Risk Advisors",
    companyName: "Meridian Risk Advisors, LLC",
    tagline: "Your outsourced virtual CISO team",
    primaryColor: "#1E3A5F",
    accentColor: "#D4A017",
    supportEmail: "support@meridianriskadvisors.example",
    footerNote: "Powered by ShieldAI",
  });
  if (brandPatch.ok) {
    db.data.branding.push({ ownerUserId: analyst.id, createdAt: daysAgo(60), updatedAt: daysAgo(60), ...brandPatch.patch });
    console.log('   Demo analyst branded as "Meridian Risk Advisors"');
  } else {
    console.log(`   Branding skipped: ${brandPatch.error}`);
  }

  // ── CVE + dark-web exposure ──────────────────────────────────────
  // CVE is a REAL, rate-limited NVD lookup (see the fixed DEMO_STACKS in
  // cveService.js); dark-web is fully canned/local (demoIntel.js). Both are
  // single-snapshot per user, so this reflects Lakeside Financial Advisors'
  // profile (see the fixture fix above) regardless of which company's
  // assessment a visitor happens to be viewing.
  console.log("\n▶ CVE + dark-web exposure (real NVD lookup — may take a while without NVD_API_KEY)");
  try {
    await refreshClientExposure(db, user.id, { isDemo: true });
    console.log("   CVE exposure cached.");
  } catch (err) {
    console.log(`   CVE exposure skipped: ${err.message}`);
  }
  try {
    await refreshClientDarkweb(db, user.id, { isDemo: true });
    console.log("   Dark-web exposure cached.");
  } catch (err) {
    console.log(`   Dark-web exposure skipped: ${err.message}`);
  }

  // ── Notifications + client↔staff chat ───────────────────────────
  console.log("\n▶ Notifications + messages");
  pushNotification(db, { userId: user.id, type: "program_ready", title: "Your security program is ready",
    body: "Mastermind finished generating your prioritized roadmap, policies, and compliance mapping.", actorRole: "system" });
  pushNotification(db, { userId: user.id, type: "review_approved", title: "Policy approved",
    body: "Your security analyst reviewed and approved your Incident Response Policy.", actorRole: "analyst" });
  pushNotification(db, { userId: user.id, type: "training_completed", title: "Training milestone reached",
    body: "4 of 6 team members completed Q1 security awareness training.", actorRole: "system" });

  db.data.clientMessages.push(
    { id: randomUUID(), clientUserId: user.id, fromRole: "staff", authorId: analyst.id,
      authorLabel: "ShieldAI Demo Analyst",
      body: "Hi — I reviewed your latest endpoint report. A couple of the manufacturing floor machines need attention when you have a minute.",
      at: daysAgo(9) },
    { id: randomUUID(), clientUserId: user.id, fromRole: "client", authorId: user.id,
      authorLabel: DEMO_COMPANY, body: "Thanks for flagging it — can you send over what specifically needs fixing?", at: daysAgo(9) },
    { id: randomUUID(), clientUserId: user.id, fromRole: "staff", authorId: analyst.id,
      authorLabel: "ShieldAI Demo Analyst",
      body: "Just forwarded a few recommendations to your dashboard — the RDP exposure is the most urgent one.", at: daysAgo(8) },
    { id: randomUUID(), clientUserId: user.id, fromRole: "client", authorId: user.id,
      authorLabel: DEMO_COMPANY, body: "Got it, we'll take care of that this week.", at: daysAgo(7) },
  );
  console.log("   3 notifications, 4-message chat thread");

  await db.write();
  console.log(`\n✅ Demo seed complete — written to demo-db.json ONLY.`);
  console.log(`   ${COMPANIES.length} companies, each with a full program + policies.`);
  console.log(`   Plus: endpoints, recommendations, tasks, evidence, vendors, training delivery,`);
  console.log(`   phishing simulations, policy acknowledgment, compliance calendar, branding,`);
  console.log(`   CVE/dark-web exposure, and notifications — every customer-facing feature.`);
  console.log(`   Client persona:  ${DEMO_EMAIL}`);
  console.log(`   Analyst persona: ${DEMO_ANALYST_EMAIL}`);
  console.log(`   Visitors enter via the public "Try the demo" button — no credentials.`);
  return { companies: COMPANIES.length, clientEmail: DEMO_EMAIL, analystEmail: DEMO_ANALYST_EMAIL };
}

// ── Public API ────────────────────────────────────────────────
// Everything runs bound to the DEMO store. Production is never opened for
// writing. Exported so server.js can seed in the background on boot without
// spawning a second process (and without blocking app.listen()).
export function seedDemoStore() {
  return runInStore(DEMO_STORE, () => main());
}

// Has the sandbox already been built? Lets callers skip a costly re-seed.
export async function isDemoSeeded() {
  return runInStore(DEMO_STORE, async () => {
    await db.read();
    const emails = new Set((db.data.users || []).map(u => u.email));
    return emails.has(DEMO_EMAIL) && emails.has(DEMO_ANALYST_EMAIL);
  });
}

// ── CLI entry point ───────────────────────────────────────────
// Only runs when invoked directly (`node seedDemo.js`), not when imported.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  seedDemoStore()
    .then(() => process.exit(0))
    .catch(err => { console.error("Seed failed:", err.message || err); process.exit(1); });
}
