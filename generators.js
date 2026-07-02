// generators.js
// Defines the 10-step "Complete Security Program" generation pipeline.
// Each step is a small, focused prompt that returns a small JSON chunk —
// this avoids the token-truncation issues that come from asking for
// everything in one giant response.

// Appended to every AUTHORED step's system prompt (policies, roadmap,
// workflows, training, exec report, threat narrative, tools). These steps are
// legitimately AI-*written*, but must be grounded in the client's real
// assessment inputs and must NOT invent verifiable facts. The hard-fact items
// (posture score, compliance mapping, CVEs, dark-web status) are produced from
// deterministic/live sources elsewhere and are never authored here.
export const NO_FABRICATION = `

GROUNDING & ACCURACY RULES (critical):
- Base everything ONLY on the business context provided. Do not assume facts that were not given.
- Do NOT invent verifiable specifics: no made-up statistics, breach numbers, CVE IDs, dollar figures presented as fact, compliance-certification claims, dates, or citations.
- Do NOT name specific commercial product brands, versions, or exact prices unless they were provided in the business context. Refer to tool CATEGORIES and capabilities instead (e.g. "a reputable endpoint protection platform"), and express cost only as the coarse ranges defined in the schema.
- When you reference a standard or framework, name only well-established ones (e.g. NIST CSF, CIS Controls, HIPAA, PCI DSS, SOC 2) and only if relevant to the stated industry/needs. Never fabricate a standard.
- This content is AI-drafted guidance for human review, not verified fact. Keep claims general and defensible rather than specific and unverifiable.`;

export const PIPELINE = [
  {
    key: "riskOverview",
    label: "Risk overview & top threats",
    maxTokens: 1500,
    system: `You are a senior CISO. Return ONLY valid JSON, no markdown fences:
{"riskScore":0-100,"riskLevel":"Low|Medium|High|Critical","executiveSummary":"3-4 sentences","topThreats":[{"threat":"","likelihood":"High|Medium|Low","impact":"High|Medium|Low","description":""}]}
Limit topThreats to exactly 3 items. Keep descriptions to 1 sentence.`,
  },
  {
    key: "priorities",
    label: "Prioritized roadmap & quick wins",
    maxTokens: 2000,
    system: `You are a senior CISO. Return ONLY valid JSON, no markdown fences:
{"priorities":[{"id":"P1","rank":1,"title":"","description":"","effort":"Quick Win|30 Days|90 Days|Long Term","impact":"High|Medium|Low","category":"Identity|Network|Data|Endpoint|Compliance|Awareness|AppSec|Physical","owner":"IT|Leadership|All Staff","estimatedCost":"$0|<$500|$500-2k|$2k-10k|$10k+"}],"quickWins":[{"action":"","benefit":"","howTo":""}]}
Limit priorities to exactly 5 items and quickWins to exactly 3 items. Keep descriptions to 1 sentence each.`,
  },
  {
    key: "policiesCore",
    label: "Core security policies",
    maxTokens: 2500,
    system: `You are a CISO drafting security policies. Return ONLY valid JSON, no markdown fences:
{"policies":[{"id":"POL1","name":"","purpose":"1 sentence","scope":"1 sentence","policyText":"3-4 sentences of actual policy language","procedures":["step 1","step 2","step 3"],"reviewCycle":"Annual|Semi-Annual|Quarterly","owner":""}]}
Generate exactly these 3 policies: Acceptable Use Policy, Password & Authentication Policy, Data Classification Policy.`,
  },
  {
    key: "policiesOps",
    label: "Operational security policies",
    maxTokens: 2500,
    system: `You are a CISO drafting security policies. Return ONLY valid JSON, no markdown fences:
{"policies":[{"id":"POL4","name":"","purpose":"1 sentence","scope":"1 sentence","policyText":"3-4 sentences of actual policy language","procedures":["step 1","step 2","step 3"],"reviewCycle":"Annual|Semi-Annual|Quarterly","owner":""}]}
Generate exactly these 3 policies: Incident Response Policy, Remote Work & BYOD Policy, Vendor & Third-Party Risk Policy.`,
  },
  {
    key: "compliance",
    label: "Compliance framework gap analysis",
    maxTokens: 2500,
    system: `You are a compliance expert. Return ONLY valid JSON, no markdown fences:
{"frameworks":[{"name":"","applicability":"Required|Recommended|Optional","overallScore":0-100,"certificationPath":"1 sentence","gaps":[{"control":"","status":"Missing|Partial|Compliant","remediation":"1 sentence","priority":"High|Medium|Low"}]}]}
Limit to the 2-3 most relevant frameworks for this business based on its industry and stated compliance needs. Limit gaps to 3 per framework.`,
  },
  {
    key: "workflows",
    label: "Incident response workflows",
    maxTokens: 2500,
    system: `You are a CISO building incident response workflows. Return ONLY valid JSON, no markdown fences:
{"workflows":[{"id":"WF1","name":"","category":"Incident Response|Access Management|Change Management|Vendor Risk|Awareness|Monitoring","trigger":"1 sentence","severity":"Critical|High|Medium|Low","steps":[{"step":1,"action":"1 sentence","responsible":"","timeframe":"","tools":""}],"escalationPath":["Tier 1","Tier 2","Tier 3"],"successCriteria":"1 sentence"}]}
Generate exactly 3 workflows: one for Ransomware/Malware, one for Phishing/Account Compromise, one for Data Breach. Limit steps to 4 per workflow.`,
  },
  {
    key: "threatIntel",
    label: "Threat intelligence",
    maxTokens: 2000,
    // NOTE: recentCVEs are NOT generated by the AI. server.js handles this step
    // specially: it queries the live NIST National Vulnerability Database (NVD)
    // for REAL CVEs matching the client's software, and queries Have I Been Pwned
    // for REAL breach/dark-web exposure. The AI provides only the industry-threat
    // narrative below. It must never invent CVE IDs or breach status.
    system: `You are a threat intelligence analyst. Return ONLY valid JSON, no markdown fences:
{"threatLandscape":{"industryThreats":[{"name":"","description":"1 sentence","prevalence":"High|Medium|Low","mitigations":["mitigation 1","mitigation 2"]}]}}
Limit industryThreats to exactly 3, tailored to the business's industry and tech stack. Do NOT include CVEs or dark-web/breach status — those are supplied separately from authoritative live sources (NVD and Have I Been Pwned).`,
  },
  {
    key: "tools",
    label: "Recommended tool categories",
    maxTokens: 2000,
    system: `You are a security architect. Return ONLY valid JSON, no markdown fences:
{"toolStack":[{"category":"","subcategory":"","capability":"what to look for, 1 sentence — NO brand names","selectionCriteria":"how to choose, 1 sentence","rationale":"why this matters for THIS business, 1 sentence","cost":"Free|<$50/mo|$50-200/mo|$200+/mo","implementation":"Easy|Moderate|Complex"}]}
Cover exactly these 6 categories: Endpoint Protection, Email Security, Password Management, Backup, MFA/Identity, and Network/DNS Security. Describe the CAPABILITY to look for in each category and selection criteria — do NOT name specific commercial products, vendors, or brands, and do NOT state exact prices (use only the coarse cost ranges in the schema). Match the cost range and implementation difficulty to the business's stated budget and size.`,
  },
  {
    key: "training",
    label: "Awareness training program",
    maxTokens: 3000,
    system: `You are a security awareness trainer. Return ONLY strictly valid, minified JSON (no markdown fences, no trailing commas, no text before or after):
{"trainingProgram":{"modules":[{"id":"MOD1","title":"","audience":"All Staff|IT|Leadership|Finance","duration":"15 min|30 min|1 hour","topics":["topic 1","topic 2","topic 3"],"keyTakeaways":["takeaway 1","takeaway 2","takeaway 3"],"quiz":[{"question":"","options":["a","b","c","d"],"correct":0}]}],"phishingSimulation":{"frequency":"Monthly|Quarterly","scenarios":["scenario 1","scenario 2"]}}}
Limit to exactly 2 modules. Each quiz array has exactly 1 question with exactly 4 options. Keep all text short.`,
  },
  {
    key: "execReport",
    label: "Executive summary report",
    maxTokens: 2000,
    system: `You are writing an executive CISO report. Return ONLY valid JSON, no markdown fences:
{"executiveReport":{"headline":"1 sentence","securityPosture":"2 sentences","businessRisk":"2 sentences","investmentRequired":"$ range","roi":"1 sentence","keyFindings":["finding 1","finding 2","finding 3"],"nextSteps":[{"action":"","owner":"","dueDate":"","priority":"High|Medium|Low"}]}}
Limit keyFindings to 3 and nextSteps to 3.`,
  },
];