// findingImpact.js
// AI-generated "what this could mean for your business" narratives for
// findings that don't already carry one — today, that's CVEs.
//
// Same house style as remediationPlan.js: real facts in, Mastermind narrates,
// a deterministic fallback covers every case where AI is unavailable or
// declines. Never invents an exploit scenario the CVSS/KEV facts don't
// support, and never touches the posture score — this is narrative text for
// a detail view, not a scoring input.
//
// CACHING: the narrative is a function of the CVE's own facts (id, severity,
// score, KEV status), not of which client is looking at it — the same
// CVE-2024-1234 means the same thing for every business running the affected
// software. Cached once per CVE id in db.data.cveImpactCache, keyed by CVE id
// plus a short hash of the facts that would change the narrative (so a KEV
// addition or a rescore invalidates the cache instead of serving stale text).

import { createHash } from "crypto";

function factsKey(facts) {
  const stable = {
    severity: facts.severity || null,
    score: facts.score ?? null,
    kev: !!facts.kev,
    kevRansomware: !!facts.kev?.knownRansomwareCampaignUse,
  };
  return createHash("sha1").update(JSON.stringify(stable)).digest("hex").slice(0, 12);
}

// Severity-keyed template used whenever AI narration isn't available. Stays
// strictly within what the CVSS/KEV facts actually support — no invented
// attack scenario, no claim about data this specific business holds.
function deterministicImpact({ severity, score, kev }) {
  const sev = String(severity || "UNKNOWN").toUpperCase();
  const scoreLine = score != null ? ` (CVSS ${score})` : "";

  if (kev) {
    const ransomware = kev.knownRansomwareCampaignUse
      ? " CISA has also linked it to known ransomware activity."
      : "";
    return `This vulnerability${scoreLine} is on CISA's Known Exploited Vulnerabilities list — ` +
      `attackers are actively using it against real targets right now, not just in theory.${ransomware} ` +
      `Any affected system reachable from the internet is at immediate, confirmed risk. This should be ` +
      `prioritized ahead of other open findings.`;
  }

  const bySeverity = {
    CRITICAL: `A ${sev} severity${scoreLine} finding typically allows an attacker to fully compromise the affected ` +
      `system — run their own code, take administrator control, or access all data it holds — often without ` +
      `needing valid credentials first.`,
    HIGH: `A ${sev} severity${scoreLine} finding typically gives an attacker significant unauthorized access — ` +
      `reading or modifying data, or disrupting the system's operation — though it may require some existing ` +
      `access or specific conditions to exploit.`,
    MEDIUM: `A ${sev} severity${scoreLine} finding is a real weakness, typically limited in what it lets an ` +
      `attacker directly do on its own, but it can still expose data or be combined with other issues to widen ` +
      `an attack.`,
    LOW: `A ${sev} severity${scoreLine} finding has limited impact on its own — usually information disclosure or ` +
      `a minor disruption — but leaving it unpatched still adds to the systems an attacker could probe.`,
  };

  return bySeverity[sev] ||
    `This finding's severity hasn't been confirmed${scoreLine}. Treat it as a real gap until it's assessed, ` +
    `patched, or the affected software is confirmed not in use.`;
}

/**
 * Get (or generate + cache) the plain-language impact narrative for one CVE.
 *
 * `cve` — { id, description, severity, score, kev } as already produced by
 * cveService.js's normalize()/kevService.js's enrichment. Nothing here calls
 * NVD/CISA again; those facts are already fetched and passed in.
 */
export async function cveImpact(db, cve, { callClaudeText } = {}) {
  db.data.cveImpactCache ||= {};
  const key = factsKey(cve);
  const cached = db.data.cveImpactCache[cve.id];
  if (cached && cached.factsKey === key) {
    return { impact: cached.impact, source: cached.source, cachedAt: cached.cachedAt };
  }

  let impact = deterministicImpact(cve);
  let source = "deterministic";

  if (callClaudeText) {
    const prompt = `A vulnerability scan found this CVE affecting the client's software:

CVE: ${cve.id}
NVD DESCRIPTION: ${cve.description || "(no description available)"}
SEVERITY: ${cve.severity || "UNKNOWN"}${cve.score != null ? ` · CVSS ${cve.score}` : ""}
ACTIVELY EXPLOITED (CISA KEV): ${cve.kev ? "YES" + (cve.kev.knownRansomwareCampaignUse ? " — known ransomware use" : "") : "No"}

Write a short paragraph (3-5 sentences) explaining what this vulnerability could actually let an attacker do,
in plain language a non-technical business owner would understand. Requirements:
- Ground everything in the severity/CVSS/KEV facts given above — do not invent an exploit scenario, a specific
  data type this business holds, or a specific attack chain beyond what those facts support.
- If KEV is YES, say plainly that this is not theoretical — it is being used against real targets now.
- No preamble, no markdown, no headers. Plain text only.`;

    try {
      const text = await callClaudeText({
        system: "You are ShieldAI Mastermind, a precise virtual-CISO advisor. You state only what the provided " +
          "vulnerability facts support. You never invent details about a specific business or a specific exploit.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 350,
      });
      if (text && text.trim()) {
        impact = text.trim();
        source = "ai";
      }
    } catch {
      // Falls through to the deterministic text already assigned above.
    }
  }

  const cachedAt = new Date().toISOString();
  db.data.cveImpactCache[cve.id] = { impact, source, factsKey: key, cachedAt };
  return { impact, source, cachedAt };
}
