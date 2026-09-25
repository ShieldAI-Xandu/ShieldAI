// agentAvCoverage.test.mjs — run: node agentAvCoverage.test.mjs
// The av_threats check gates auto-resolution of "av-detection" vulnerabilities:
// an "unknown" (AV history not readable) must NEVER be treated as "it was fixed".
import { syncAgentFindings, latestVersionFor } from "./agentRoutes.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const agent = { id: "a1", ownerUserId: "u1", hostname: "HOST1" };
const finding = { key: "av:42", kind: "av-detection", severity: "high", title: "Active malware threat: X", detail: "d" };
const avCheck = status => ({ id: "av_threats", status });
const report = (checks, findings = []) => ({ host: { hostname: "HOST1" }, checks, findings });
const mkDb = () => ({ data: {} });

console.log("av_threats coverage gates resolution:");
{
  const db = mkDb();
  syncAgentFindings(db, agent, report([avCheck("warn")], [finding]));
  ok(db.data.agentVulnerabilities.length === 1 && db.data.agentVulnerabilities[0].status === "open", "detection opens a vulnerability");

  const r1 = syncAgentFindings(db, agent, report([avCheck("unknown")], []));
  ok(r1.resolved === 0 && db.data.agentVulnerabilities[0].status === "open", "unknown av_threats does NOT resolve it");

  const r2 = syncAgentFindings(db, agent, report([], []));
  ok(r2.resolved === 0 && db.data.agentVulnerabilities[0].status === "open", "missing av_threats check does NOT resolve it");

  const r3 = syncAgentFindings(db, agent, report([avCheck("pass")], []));
  ok(r3.resolved === 1 && db.data.agentVulnerabilities[0].status === "resolved", "a readable, clean av_threats resolves it");
}

console.log("\nmacOS/Linux-style report (events only, no findings[]):");
{
  const db = mkDb();
  const r = syncAgentFindings(db, agent, { host: {}, checks: [avCheck("warn")], events: [{ type: "malware_detected" }] });
  ok(r.opened === 0 && r.resolved === 0, "no findings array -> nothing opened or resolved");
}

console.log("\nVersions:");
ok(["windows", "linux", "macos"].every(o => latestVersionFor(o) === "1.4.0"), "all three collectors advertise 1.4.0");

process.exit(fail ? 1 : 0);
