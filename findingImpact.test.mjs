// findingImpact.test.mjs — run: node findingImpact.test.mjs
import { cveImpact } from "./findingImpact.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const mkDb = () => ({ data: {} });
const CVE = { id: "CVE-2024-1234", description: "A remote code execution flaw.", severity: "CRITICAL", score: 9.8, kev: null };
const KEV_CVE = { ...CVE, id: "CVE-2024-5678", kev: { knownRansomwareCampaignUse: true, dueDate: "2026-01-01" } };

console.log("Deterministic fallback (no AI provider):");
{
  const db = mkDb();
  const r = await cveImpact(db, CVE);
  ok(r.source === "deterministic", `falls back cleanly (source: ${r.source})`);
  ok(/CRITICAL/i.test(r.impact) || /9\.8/.test(r.impact), "grounds the text in the real severity/score");
  ok(!/ransomware/i.test(r.impact), "does not claim ransomware use for a CVE with no KEV record");

  const kevResult = await cveImpact(db, KEV_CVE);
  ok(/actively|exploited|CISA/i.test(kevResult.impact), "KEV-flagged CVE gets the urgent framing");
  ok(/ransomware/i.test(kevResult.impact), "and mentions the real ransomware-use fact when present");
}

console.log("\nCaching — same facts, no regeneration:");
{
  const db = mkDb();
  let calls = 0;
  const callClaudeText = async () => { calls++; return "An AI-written impact paragraph."; };

  const first = await cveImpact(db, CVE, { callClaudeText });
  ok(first.source === "ai" && calls === 1, "first call generates via AI");

  const second = await cveImpact(db, CVE, { callClaudeText });
  ok(calls === 1, "second call for the SAME CVE facts reuses the cache, no second AI call");
  ok(second.impact === first.impact, "returns the identical cached text");
  ok(second.cachedAt === first.cachedAt, "cachedAt is stable across reads");

  // A CVE record with different facts (e.g. KEV was just added) must NOT
  // reuse a narrative generated before that fact existed.
  const updated = { ...CVE, kev: { knownRansomwareCampaignUse: true } };
  await cveImpact(db, updated, { callClaudeText });
  ok(calls === 2, "a real change in the underlying facts invalidates the cache");
}

console.log("\nAI failure falls back to deterministic rather than erroring:");
{
  const db = mkDb();
  const throwingProvider = async () => { throw new Error("provider down"); };
  const r = await cveImpact(db, CVE, { callClaudeText: throwingProvider });
  ok(r.source === "deterministic", "AI error -> deterministic text, not a thrown error");
  ok(r.impact.length > 0, "still returns real, non-empty text");

  const blankProvider = async () => "   ";
  const r2 = await cveImpact(mkDb(), CVE, { callClaudeText: blankProvider });
  ok(r2.source === "deterministic", "a blank AI response also falls back rather than caching empty text");
}

console.log("\nGrounding — never fabricates beyond the given severity:");
{
  const db = mkDb();
  const unknownSev = { id: "CVE-2024-0001", description: "", severity: null, score: null, kev: null };
  const r = await cveImpact(db, unknownSev);
  ok(/hasn't been confirmed|assessed/i.test(r.impact), "an unrated CVE is described as unconfirmed, not assigned a fake severity");
}

console.log(fail === 0 ? "\nCVE impact narrative verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
