// integrationAdapters.js
// Per-vendor format adapters for integrationRoutes.js's webhook endpoint.
//
// WHY THIS EXISTS: most vulnerability/EDR tools have no native way to push a
// custom JSON shape to an arbitrary URL — they expose a pull/REST API (or, at
// best, a SOAR workflow feature) that returns THEIR OWN field names and
// severity scales. Rather than making every client hand-write a field
// mapping, each adapter here recognizes that vendor's native JSON shape (as
// produced by a client's own forwarding script/SOAR workflow) and normalizes
// it into ShieldAI's internal finding shape:
//   { externalId, title, severity, category, host, cve, message, raw }
// where severity is one of: critical | high | medium | low | info.
//
// A client can ALWAYS skip this entirely and POST our generic
// { findings: [...] } shape directly (see AddIntegrationModal's sample
// payload) — these adapters are a convenience layer on top, not a
// requirement. If an adapter doesn't recognize the payload shape, it returns
// null and the webhook route falls back to the generic parser.
//
// CONFIDENCE NOTE (read before trusting a mapping blindly): these mappings
// were built from vendor documentation and, for CrowdStrike in particular,
// from secondary sources (CrowdStrike's own Swagger reference blocked
// automated fetch) — see inline notes per adapter. Qualys and Rapid7 involve
// fields no single API call returns (Qualys finding titles require a
// separate KnowledgeBase lookup we don't perform; Rapid7 needs a finding
// definition joined with a separate asset call) — those adapters expect the
// client's forwarding script to have already joined/attached what's needed,
// and degrade honestly (e.g. "QID 12345" instead of a real title) rather
// than inventing data we don't have. Verify against a real payload from your
// tenant before relying on a mapping in production.
//
// SECURITY NOTE: intentionally JSON-only. Qualys's native detection API is
// XML; rather than parsing untrusted third-party XML server-side (a classic
// XXE-injection risk surface), the Qualys adapter expects the client's own
// script to have already converted that XML to its natural JSON-equivalent
// shape (trivial in any language's standard library) before POSTing.

// ── shared helpers ──────────────────────────────────────────────
const CANON_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

// Normalize a vendor severity value we've already mapped to a canonical
// word; anything unrecognized falls back to "info" — same default the
// generic path uses for a missing severity. Never silently escalates.
function canonSeverity(s) {
  const v = String(s || "").toLowerCase().trim();
  return CANON_SEVERITIES.has(v) ? v : "info";
}

function firstOf(arr) {
  return Array.isArray(arr) ? arr[0] : (arr || null);
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === "object") return [x]; // XML->JSON single-child collapses to an object, not a 1-item array
  return [];
}

// ── Tenable Nessus / Tenable.io ─────────────────────────────────
// Source: developer.tenable.com "Select Vulnerability Export Properties"
// (current docs) plus an older Tenable.io integration reference. Tenable's
// docs show TWO shapes for a finding object depending on API surface/age —
// this adapter tries both rather than assuming one.
//   Shape A (older/"classic"): { asset: {...}, plugin: {...}, severity }
//   Shape B (current /vulns/export chunks): { asset: {...}, definition: {...}, severity, id }
// `severity` is confirmed to be a lowercase string (info|low|medium|high|critical)
// in both — maps directly onto our enum, no scale conversion needed.
function adaptTenable(body) {
  const items = Array.isArray(body) ? body
    : Array.isArray(body?.findings) && body.findings.some(x => x && (x.definition || x.plugin))
      ? body.findings
    : Array.isArray(body?.data) ? body.data
    : null;
  if (!items) return null;

  return items.map(x => {
    const def = x.definition || x.plugin || {};
    const asset = x.asset || {};
    const cve = firstOf(def.cve);
    const extraCves = Array.isArray(def.cve) && def.cve.length > 1 ? ` (+${def.cve.length - 1} more CVEs)` : "";
    const host = firstOf(asset.fqdns) || asset.hostname
      || firstOf(asset.ipv4_addresses) || asset.ipv4 || null;
    return {
      externalId: x.id || `${def.id || "unknown"}::${asset.uuid || asset.id || host || ""}`,
      title: def.name || `Tenable plugin ${def.id || "unknown"}`,
      severity: canonSeverity(x.severity),
      category: "vulnerability",
      host,
      cve,
      message: `${def.synopsis || def.description || ""}${extraCves}`.trim() || null,
      raw: x,
    };
  });
}

// ── Qualys VMDR ──────────────────────────────────────────────────
// Source: docs.qualys.com Host List Detection API + Qualys's own sample XML
// (github.com/QualysAPI/Qualys-API-Doc-Center). Native output is XML; this
// adapter expects the JSON-equivalent of that XML (see file header). SEVERITY
// is a confirmed 1-5 scale (1=Minimal...5=Urgent, per Qualys's own severity
// docs). Qualys does NOT return a finding title in this API — only a
// QID (vulnerability type id) that requires a separate KnowledgeBase API
// call to resolve to a name. We do not call out to Qualys (no stored
// credentials, by design), so title honestly falls back to "QID <n>" unless
// the client's own script has already attached a TITLE field itself.
const QUALYS_SEVERITY = { "1": "info", "2": "low", "3": "medium", "4": "high", "5": "critical" };

function adaptQualys(body) {
  // Try the natural nested XML->JSON shape at a few plausible depths, or a
  // pre-flattened array of detection-like objects with a host field attached.
  const hosts = asArray(
    body?.HOST_LIST_OUTPUT?.RESPONSE?.HOST_LIST?.HOST ??
    body?.RESPONSE?.HOST_LIST?.HOST ??
    body?.HOST_LIST?.HOST ??
    null
  );
  if (hosts.length > 0) {
    const out = [];
    for (const h of hosts) {
      const host = h.DNS || h.NETBIOS || h.IP || null;
      for (const d of asArray(h.DETECTION_LIST?.DETECTION)) {
        out.push({
          externalId: `${d.QID}::${h.IP || host || ""}`,
          title: d.TITLE || `QID ${d.QID}`,
          severity: QUALYS_SEVERITY[String(d.SEVERITY)] || "info",
          category: "vulnerability",
          host,
          cve: firstOf(String(d.CVE_ID || "").split(",").map(s => s.trim()).filter(Boolean)) || null,
          message: d.RESULTS || null,
          raw: d,
        });
      }
    }
    return out;
  }

  // Pre-flattened fallback: an array of detection objects that already carry
  // their own host (e.g. a client script that flattened the XML itself).
  if (Array.isArray(body?.detections)) {
    return body.detections.map(d => ({
      externalId: `${d.QID}::${d.IP || d.host || ""}`,
      title: d.TITLE || `QID ${d.QID}`,
      severity: QUALYS_SEVERITY[String(d.SEVERITY)] || "info",
      category: "vulnerability",
      host: d.DNS || d.host || d.IP || null,
      cve: firstOf(String(d.CVE_ID || "").split(",").map(s => s.trim()).filter(Boolean)) || null,
      message: d.RESULTS || null,
      raw: d,
    }));
  }

  return null;
}

// ── Rapid7 InsightVM ─────────────────────────────────────────────
// Source: docs.rapid7.com + Rapid7's own public API reference (riza/
// rapid7-insightvm-api-docs, cross-checked field names). InsightVM has no
// single call returning a full finding — a per-asset vulnerability list and
// a separate vulnerability-definition call must be joined, and host isn't
// present on the definition at all. This adapter expects the client's
// forwarding script to have already joined them and attached a host field
// (we can't invent a host we were never given). Rapid7's own severity is a
// 3-bucket string (Moderate/Severe/Critical, CVSS2-bucketed) — mapped
// straightforwardly; a future refinement could use cvss.v3.score as a
// tiebreaker for Moderate, not built here.
const RAPID7_SEVERITY = { moderate: "medium", severe: "high", critical: "critical" };

function adaptRapid7(body) {
  const items = Array.isArray(body) ? body
    : Array.isArray(body?.findings) && body.findings.some(x => x && (x.cves || x.cvss))
      ? body.findings
    : null;
  if (!items) return null;

  return items.map(x => ({
    externalId: x.id || null,
    title: x.title || x.id || "Untitled Rapid7 finding",
    severity: RAPID7_SEVERITY[String(x.severity || "").toLowerCase()] || "info",
    category: "vulnerability",
    host: x.host || x.hostName || x.ip || (Array.isArray(x.hostNames) && x.hostNames[0]?.name) || null,
    cve: firstOf(x.cves),
    message: x.description?.text || x.description?.html || null,
    raw: x,
  }));
}

// ── Microsoft Defender Vulnerability Management ───────────────────
// Source: learn.microsoft.com (Defender for Endpoint API), live-fetched,
// current as of the doc's last-updated date. This is the
// SoftwareVulnerabilitiesByMachine / SoftwareVulnerabilitiesExport shape —
// one row per device x software x CVE, no title field (synthesized here),
// no description field (synthesized as a fallback message). severity is a
// confirmed string enum (Low|Medium|High|Critical) that lowercases directly
// onto our own enum.
function adaptMsDefender(body) {
  const items = Array.isArray(body) ? body
    : Array.isArray(body?.value) ? body.value
    : null;
  if (!items) return null;
  // Only claim this shape if it actually looks like Defender TVM rows —
  // otherwise a generic { findings: [...] } array would false-positive here.
  if (!items.some(x => x && (x.cveId || x.deviceName))) return null;

  return items.map(x => ({
    externalId: x.id || `${x.deviceId || ""}::${x.cveId || ""}`,
    title: x.cveId ? `${[x.softwareVendor, x.softwareName, x.softwareVersion].filter(Boolean).join(" ")} — ${x.cveId}`.trim() : "Untitled Defender finding",
    severity: canonSeverity(x.vulnerabilitySeverityLevel),
    category: "vulnerability",
    host: x.deviceName || x.deviceId || null,
    cve: x.cveId || null,
    message: x.recommendedSecurityUpdate ? `Recommended update: ${x.recommendedSecurityUpdate}` : null,
    raw: x,
  }));
}

// ── CrowdStrike Falcon ─────────────────────────────────────────────
// Two distinct native shapes, auto-detected per item:
//
// (a) Detection/alert events, pushed via Falcon Fusion SOAR's native "Call
//     webhook" workflow action — the ONE vendor of these five with a genuine
//     point-and-click outbound webhook (developer.crowdstrike.com Fusion SOAR
//     docs). Field names here are LOWER CONFIDENCE: sourced from
//     third-party SIEM field-mapping docs (Elastic/Splunk), not CrowdStrike's
//     own reference (blocked by a 403 during research). Verify against your
//     tenant's actual Fusion SOAR webhook payload before trusting this.
//     Numeric Severity 0-5: 0/1=Informational, 2=Low, 3=Medium, 4=High, 5=Critical.
//
// (b) Falcon Spotlight vulnerability records (CVE-based vuln management,
//     pull-only via /spotlight/combined/vulnerabilities/v1 — needs a
//     forwarding script). Field names from a third-party (ThreatQ) CrowdStrike
//     integration doc, cross-checked against CrowdStrike's own falconpy SDK —
//     medium confidence. Spotlight exposes TWO severity ratings that can
//     disagree: cve.severity (CVSS-based) and cve.exprt_rating (CrowdStrike's
//     own exploit-activity-weighted rating). We use cve.severity as primary
//     (consistent with every other adapter here being CVSS-based) and surface
//     exprt_rating in the message rather than silently discarding it.
const CS_DETECTION_SEVERITY = { 0: "info", 1: "info", 2: "low", 3: "medium", 4: "high", 5: "critical" };

function adaptCrowdstrike(body) {
  const items = Array.isArray(body) ? body
    : Array.isArray(body?.resources) ? body.resources
    : (body && typeof body === "object") ? [body] // Fusion SOAR posts one event per call
    : null;
  if (!items || items.length === 0) return null;

  const out = [];
  for (const x of items) {
    if (x.cve && typeof x.cve === "object") {
      // Spotlight vulnerability record.
      const cveId = x.vulnerability_id || x.cve.id || null;
      const exprt = x.cve.exprt_rating ? ` CrowdStrike ExPRT rating: ${x.cve.exprt_rating}.` : "";
      out.push({
        externalId: x.id || `${cveId || ""}::${x.aid || x.host_info?.hostname || ""}`,
        title: cveId ? `${cveId} on ${x.host_info?.hostname || "host"}` : "Untitled CrowdStrike Spotlight finding",
        severity: canonSeverity(x.cve.severity),
        category: "vulnerability",
        host: x.host_info?.hostname || null,
        cve: cveId,
        message: `${x.cve.description || ""}${exprt}`.trim() || null,
        raw: x,
      });
    } else if (x.Severity != null || x.severity != null || x.ComputerName || x.DetectDescription) {
      // Detection/alert event (field-name casing uncertain — try both).
      const sev = x.Severity ?? x.severity;
      out.push({
        externalId: x.DetectId || x.detect_id || x.composite_id || x.id || null,
        title: x.DetectDescription || x.detect_description || x.description || "CrowdStrike detection",
        severity: CS_DETECTION_SEVERITY[Number(sev)] ?? canonSeverity(sev),
        category: "detection",
        host: x.ComputerName || x.computer_name || x.hostname || x.device?.hostname || null,
        cve: null,
        message: x.DetectDescription || x.detect_description || x.description || null,
        raw: x,
      });
    }
  }
  return out.length > 0 ? out : null;
}

// ── dispatch ─────────────────────────────────────────────────────
const VENDOR_ADAPTERS = {
  nessus: adaptTenable,
  qualys: adaptQualys,
  rapid7: adaptRapid7,
  msdefender: adaptMsDefender,
  crowdstrike: adaptCrowdstrike,
};

// Normalize an incoming webhook body for the given integration's provider.
// Tries the vendor-specific adapter first (only "claims" the payload if it
// actually recognizes the shape); falls back to the generic { findings: [] }
// wrapper. Returns an array of normalized finding objects, or null if
// nothing recognized the payload at all.
export function normalizeIncomingFindings(provider, body) {
  const adapter = VENDOR_ADAPTERS[provider];
  if (adapter) {
    try {
      const mapped = adapter(body);
      if (mapped) return mapped;
    } catch (err) {
      console.warn(`Integration adapter (${provider}) failed to parse payload, falling back to generic shape:`, err.message);
    }
  }
  return Array.isArray(body?.findings) ? body.findings : null;
}
