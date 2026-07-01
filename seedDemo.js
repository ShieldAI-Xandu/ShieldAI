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
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import db from "./db.js";
import { PIPELINE } from "./generators.js";
import { computePostureScore } from "./riskEngine.js";
import { POLICY_CATALOG } from "./policyCatalog.js";
import { buildStructurePrompt } from "./policyFormats.js";

const DEMO_EMAIL = "demo@shieldai.com";
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
    },
    policies: ["incident-response", "data-classification"],
  },
  {
    company: { name: "Lakeside Financial Advisors", industry: "Financial Services", employees: "28" },
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
    },
    policies: ["access-control", "vendor-risk"],
  },
  {
    company: { name: "Apex Manufacturing", industry: "Manufacturing", employees: "120" },
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
  db.data.policyDocs.push({
    id: randomUUID(), userId, policyId, policyName: def.name,
    createdAt: new Date().toISOString(),
    companyContext: companyData.company, answers: {}, content,
  });
  console.log(`    · policy: ${def.name}`);
}

// ── Seed routine (exported so the server can run it on first boot) ──
// force=false: if the demo user already exists, do nothing (idempotent).
// force=true : re-seed, clearing the demo user's prior data first.
export async function demoExists() {
  await db.read();
  db.data.users ||= [];
  return !!db.data.users.find(u => u.email === DEMO_EMAIL);
}

export async function seedDemo({ force = false } = {}) {
  await db.read();
  db.data.users ||= []; db.data.assessments ||= []; db.data.programs ||= []; db.data.policyDocs ||= [];

  // Find or create the demo user
  let user = db.data.users.find(u => u.email === DEMO_EMAIL);
  if (user && !force) {
    console.log(`Demo account ${DEMO_EMAIL} already exists — skipping seed.`);
    return { seeded: false, reason: "exists" };
  }
  if (user) {
    console.log("Removing previous demo data…");
    db.data.assessments = db.data.assessments.filter(a => a.userId !== user.id);
    db.data.programs = db.data.programs.filter(p => p.userId !== user.id);
    db.data.policyDocs = db.data.policyDocs.filter(p => p.userId !== user.id);
  } else {
    user = {
      id: randomUUID(), email: DEMO_EMAIL, companyName: DEMO_COMPANY,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      isAdmin: false, isAnalyst: false, createdAt: new Date().toISOString(),
    };
    db.data.users.push(user);
    console.log(`Created demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  for (const co of COMPANIES) {
    console.log(`\n▶ ${co.company.name} (${co.company.industry})`);
    const assessment = {
      id: randomUUID(), userId: user.id, createdAt: new Date().toISOString(),
      data: { company: co.company, compliance: co.compliance, summary: co.summary, checklist: co.checklist },
    };
    db.data.assessments.push(assessment);

    await generateProgram(user.id, assessment.id, assessment.data);
    for (const pid of (co.policies || [])) {
      await generatePolicy(user.id, pid, assessment.data);
    }
    await db.write(); // save progress after each company
  }

  await db.write();
  console.log(`\n✅ Demo seed complete. Log in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`   ${COMPANIES.length} companies, each with a full program + policies.`);
  return { seeded: true, companies: COMPANIES.length };
}

// Run directly from the CLI: `node seedDemo.js` (force re-seed).
// import.meta.url matches the entry point only when executed directly.
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  seedDemo({ force: true })
    .then(() => process.exit(0))
    .catch(err => { console.error("Seed failed:", err); process.exit(1); });
}
