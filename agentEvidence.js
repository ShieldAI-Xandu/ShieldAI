// agentEvidence.js
// Bridges read-only agent telemetry into framework evidence.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// Every framework assessment we run is fed by a questionnaire. A client tells
// us their disks are encrypted; we believe them; ISO A.8.24 goes green. That is
// how the entire compliance-software category works, and it is the category's
// weakest point: an auditor's first question is "how do you know?", and
// "the customer said so" is not an answer.
//
// The agent already measures some of this. It reports BitLocker state, firewall
// profiles, pending patches, local admin counts, AV status — as observed facts
// from the machine itself. That telemetry is strictly better evidence than a
// checkbox, and it is the thing competitors with no endpoint presence cannot
// produce.
//
// THREE RULES, DECIDED DELIBERATELY
// ----------------------------------
// 1. THE AGENT INFORMS; THE QUESTIONNAIRE DECIDES.
//    Agent telemetry never overwrites a client's answer, and never silently
//    becomes one. The agent sees endpoints. A framework control is
//    organisational: "is data encrypted at rest" covers the file server, the
//    S3 bucket, and the backup tapes, not just the three laptops running our
//    collector. Promoting endpoint telemetry to an org-wide answer would be
//    exactly the kind of confident-but-wrong claim this product exists to
//    avoid.
//
// 2. DISAGREEMENT IS SURFACED, NOT RESOLVED.
//    When the client says "fully encrypted" and the agent sees BitLocker off on
//    two of five machines, we do not pick a winner. We mark the evidence
//    `disputed` and route it to an analyst. Auto-resolving in the agent's
//    favour would punish clients for having one unmanaged laptop; auto-
//    resolving in the client's favour would make the telemetry decorative.
//    A dispute is a genuine finding — often the most valuable output of the
//    whole assessment, because it is the gap between what a business believes
//    and what is true.
//
// 3. COVERAGE IS ALWAYS STATED.
//    "Three of five hosts report BitLocker on" means nothing without knowing
//    whether those five are the whole fleet. We report host counts and never
//    imply fleet-wide truth from partial coverage.
//
// WHAT THIS IS NOT
// ----------------
// Not a control channel. The agent is permanently read-only — it observes and
// reports, and nothing here sends it instructions. This module only reads
// reports the agent already pushed.

import { SECURITY_CHECKLIST } from "./securityChecklist.js";

// ── How agent checks map to checklist evidence ────────────────
// `checkId` is the id the collectors emit (see agent/*/collect.*).
// `evidence` is the checklist question this observation speaks to.
// `scope` is the honest reach of the observation:
//    endpoint      — true of the reporting machine only.
//    endpoint-set  — meaningful in aggregate across reporting hosts.
// Nothing here is org-wide, because an endpoint agent cannot see the org.
export const AGENT_EVIDENCE_MAP = [
  {
    checkId: "disk_encryption",
    evidence: "encryptionAtRest",
    scope: "endpoint-set",
    observes: "Whether the system drive is encrypted (BitLocker / LUKS / FileVault).",
    limits:
      "Covers the boot volume of reporting hosts only. Says nothing about file servers, databases, cloud storage, or backups — which is usually where the sensitive data actually lives.",
    // pass -> the answer this observation is consistent with.
    consistentWith: {
      pass: ["Yes — full-disk plus database/file encryption, keys managed", "Full-disk encryption on laptops and servers"],
      fail: ["Some systems only", "No / not sure"],
    },
  },
  {
    checkId: "firewall",
    evidence: "endpoint",
    scope: "endpoint-set",
    observes: "Host firewall enabled across all profiles.",
    limits: "Host firewall only — not the network perimeter, and not a substitute for endpoint protection generally.",
    consistentWith: {
      pass: ["Advanced EDR (CrowdStrike, SentinelOne, etc.)", "Built-in protection (Windows Defender, etc.)"],
      fail: ["None / not sure"],
    },
  },
  {
    checkId: "av_realtime",
    evidence: "endpoint",
    scope: "endpoint-set",
    observes: "Antivirus real-time protection is active.",
    limits: "Reports the state of the registered AV product. Cannot judge whether that product is adequate for the threat model.",
    consistentWith: {
      pass: ["Advanced EDR (CrowdStrike, SentinelOne, etc.)", "Built-in protection (Windows Defender, etc.)"],
      fail: ["None / not sure"],
    },
  },
  {
    checkId: "patches",
    evidence: "vulnManagement",
    scope: "endpoint-set",
    observes: "Count of pending OS updates.",
    limits:
      "OS patches on reporting hosts. Not third-party application patching, not network gear, not the scanning-and-SLA process the control actually asks about.",
    consistentWith: {
      pass: ["Regular scanning with tracked remediation SLAs", "Automatic updates enabled, occasional scans"],
      fail: ["We patch when something breaks or makes the news", "No process / not sure"],
    },
  },
  {
    checkId: "local_admins",
    evidence: "privilegedAccess",
    scope: "endpoint-set",
    observes: "Number of accounts in the local Administrators group.",
    limits:
      "Local admin rights on reporting hosts. Says nothing about domain admins, cloud tenant roles, or SaaS admin sprawl — which is where privilege escalation usually lives.",
    consistentWith: {
      pass: ["Separate admin accounts, MFA, access logged and time-limited", "Separate admin accounts with MFA"],
      fail: ["Some people have admin on their normal account", "Most users are local admins / not sure"],
    },
  },
  {
    checkId: "screen_lock",
    evidence: "accessReviews",
    scope: "endpoint",
    observes: "Automatic screen lock is enforced with a password.",
    limits:
      "Weak evidence, included for completeness. Screen lock is an access control but tells us almost nothing about whether access is periodically reviewed. Treated as informational only.",
    informationalOnly: true,
    consistentWith: { pass: [], fail: [] },
  },
];

const STATUS = { CONFIRMED: "confirmed", DISPUTED: "disputed", UNCORROBORATED: "uncorroborated", NO_ANSWER: "no-answer" };
export const EVIDENCE_STATUS = STATUS;

// ── Resolving a dispute ───────────────────────────────────────
// A dispute with no way to act on it is just a red badge. The client needs a
// decision point, and the honest set of choices is small:
//
//   update-answer     The agent is right and the questionnaire was optimistic.
//                     Change the answer; the control re-scores against reality.
//
//   fix-the-gap       The answer describes the intended state and the machines
//                     haven't caught up. The answer stays; a task is opened.
//
//   out-of-scope      The reporting hosts aren't representative — a test VM, a
//                     contractor's laptop, a machine being decommissioned. The
//                     answer stays and the exception is recorded WITH a reason.
//
// Nothing here resolves itself. Each option is a human decision, which is the
// whole point: the dispute exists precisely because two sources of truth
// disagree, and software guessing between them is how you get a confidently
// wrong compliance report.
export const RESOLUTION_OPTIONS = [
  {
    id: "update-answer",
    label: "The agent is right — update my answer",
    effect: "Changes your questionnaire answer to match what the agent observed. Your posture score and every affected framework re-score immediately.",
    consequence: "scores-change",
  },
  {
    id: "fix-the-gap",
    label: "My answer is the goal — these machines need fixing",
    effect: "Keeps your answer and opens a remediation task for the hosts that failed. The dispute stays open until telemetry agrees.",
    consequence: "task-created",
  },
  {
    id: "out-of-scope",
    label: "These hosts aren't in scope",
    effect: "Keeps your answer and records why the reporting hosts don't represent your environment. Requires a written reason — an auditor will read it.",
    consequence: "exception-recorded",
    requiresReason: true,
  },
];

/**
 * The decision a client is being asked to make about one dispute.
 * Pure data — presenting it is the UI's job, deciding is the human's.
 */
function resolutionFor(mapping, roll, answerLabel) {
  return {
    required: true,
    question: `Your answer says "${answerLabel}". The agent found something different on ${roll.fail > 0 ? `${roll.fail} of ${roll.hosts}` : `${roll.hosts}`} host(s). Which is right?`,
    options: RESOLUTION_OPTIONS.map(o => ({ ...o })),
    // Both sides, verbatim, so the client decides on facts rather than a verdict.
    yourAnswer: { source: "questionnaire", value: answerLabel },
    agentObserved: {
      source: "monitoring agent",
      summary: `${roll.pass} pass / ${roll.fail} fail / ${roll.warn} warn across ${roll.hosts} reporting host(s)`,
      perHost: roll.perHost,
      whatItSees: mapping.observes,
      whatItCannotSee: mapping.limits,
    },
    whyThisMatters:
      "An auditor asks how you know. A control backed by measured evidence is stronger than one backed by a checkbox — and a control where the two disagree is the first thing they'll pull on.",
    unresolvedMeaning:
      "Until this is resolved the control keeps your questionnaire answer. The dispute is recorded, not hidden — it appears in your report as an open item.",
  };
}

/**
 * Roll up one agent check across every reporting host.
 * Returns null when no host reported it.
 */
function rollUp(reports, checkId) {
  const seen = [];
  for (const r of reports) {
    const c = (r.checks || []).find(x => x.id === checkId);
    if (!c) continue;
    seen.push({ host: r.host?.hostname || "unknown", status: c.status, observed: c.observed, severity: c.severity });
  }
  if (seen.length === 0) return null;
  const pass = seen.filter(s => s.status === "pass").length;
  const fail = seen.filter(s => s.status === "fail").length;
  const warn = seen.filter(s => s.status === "warn").length;
  const unknown = seen.filter(s => s.status === "unknown").length;
  return {
    hosts: seen.length,
    pass, fail, warn, unknown,
    // Unanimity matters: "all hosts pass" is a very different claim from
    // "most hosts pass", and the difference is exactly what an auditor asks.
    unanimous: pass === seen.length || fail === seen.length,
    verdict: fail > 0 ? "fail" : warn > 0 ? "warn" : pass === seen.length ? "pass" : "mixed",
    perHost: seen,
  };
}

/**
 * Compare agent telemetry against the client's questionnaire answers.
 *
 * Returns a list of corroborations — NOT evidence to be fed into scoring.
 * The caller decides what to show. Nothing here mutates an answer.
 */
export function corroborate(agentReports = [], checklistAnswers = {}) {
  const reports = Array.isArray(agentReports) ? agentReports.filter(Boolean) : [];
  const out = [];

  for (const m of AGENT_EVIDENCE_MAP) {
    const roll = rollUp(reports, m.checkId);
    if (!roll) continue;

    const q = SECURITY_CHECKLIST.find(x => x.id === m.evidence);
    const answer = checklistAnswers[m.evidence];
    const answerLabel = typeof answer === "string" ? answer : answer?.label ?? null;

    let status, note;
    if (m.informationalOnly) {
      status = STATUS.UNCORROBORATED;
      note = "Informational only — this observation is too weak to corroborate the control.";
    } else if (!answerLabel) {
      status = STATUS.NO_ANSWER;
      note = `The agent observed this on ${roll.hosts} host(s), but the questionnaire hasn't been answered. Telemetry does not answer it for you — the control is organisational and the agent only sees endpoints.`;
    } else {
      const claimsGood = (m.consistentWith.pass || []).includes(answerLabel);
      const claimsBad = (m.consistentWith.fail || []).includes(answerLabel);

      if (claimsGood && roll.verdict === "fail") {
        status = STATUS.DISPUTED;
        note = `The questionnaire says "${answerLabel}", but the agent found this failing on ${roll.fail} of ${roll.hosts} reporting host(s). Worth reconciling before an auditor does.`;
      } else if (claimsGood && roll.verdict === "mixed") {
        status = STATUS.DISPUTED;
        note = `The questionnaire says "${answerLabel}", but agent results are mixed across ${roll.hosts} host(s) — ${roll.pass} pass, ${roll.fail} fail, ${roll.warn} warn.`;
      } else if (claimsGood && roll.verdict === "pass") {
        status = STATUS.CONFIRMED;
        note = `The agent independently confirms this on all ${roll.hosts} reporting host(s). This is measured evidence, not a self-assessment — worth showing an auditor.`;
      } else if (claimsBad && roll.verdict === "pass") {
        status = STATUS.DISPUTED;
        note = `The questionnaire says "${answerLabel}", but the agent found this passing on all ${roll.hosts} reporting host(s). The answer may understate reality — or the agent's hosts may not be representative.`;
      } else {
        status = STATUS.UNCORROBORATED;
        note = `The agent observed this on ${roll.hosts} host(s); it neither confirms nor contradicts the questionnaire answer.`;
      }
    }

    out.push({
      checkId: m.checkId,
      evidenceId: m.evidence,
      question: q?.question || m.evidence,
      scope: m.scope,
      observes: m.observes,
      limits: m.limits,
      status,
      note,
      clientAnswer: answerLabel,
      agent: roll,
      // A dispute the client can't act on is just a red badge. This is the
      // decision point: both sides shown, options offered, nothing auto-chosen.
      resolution: status === STATUS.DISPUTED ? resolutionFor(m, roll, answerLabel) : null,
      // The rule, restated on every record so it can't be lost in the UI.
      authority: "informational",
      authorityNote:
        "Agent telemetry informs; the questionnaire answer decides. Endpoint observations are not promoted to organisation-wide control answers, and a dispute is routed to an analyst rather than auto-resolved.",
    });
  }

  return out;
}

/** Just the disputes — the analyst's queue, and usually the real findings. */
export function disputes(agentReports = [], checklistAnswers = {}) {
  return corroborate(agentReports, checklistAnswers).filter(c => c.status === STATUS.DISPUTED);
}

/**
 * A compact summary for the compliance workspace header.
 * Deliberately reports coverage, because a confirmation across 2 of 40 hosts
 * is not a confirmation.
 */
export function corroborationSummary(agentReports = [], checklistAnswers = {}) {
  const all = corroborate(agentReports, checklistAnswers);
  const hosts = new Set((agentReports || []).map(r => r?.host?.hostname).filter(Boolean));
  return {
    reportingHosts: hosts.size,
    checksCorroborated: all.length,
    confirmed: all.filter(c => c.status === STATUS.CONFIRMED).length,
    disputed: all.filter(c => c.status === STATUS.DISPUTED).length,
    uncorroborated: all.filter(c => c.status === STATUS.UNCORROBORATED).length,
    noAnswer: all.filter(c => c.status === STATUS.NO_ANSWER).length,
    coverageNote:
      hosts.size === 0
        ? "No agent reports. Every control answer is self-reported — which is normal, and is what most compliance tooling relies on entirely."
        : `${hosts.size} host(s) reporting. Agent evidence covers endpoint-observable controls only; servers, cloud services, and SaaS are outside what the collector can see.`,
    boundary:
      "The agent is read-only and permanently so. It observes and reports; it accepts no inbound commands, and nothing in the compliance workflow changes that.",
  };
}

/** Which checklist questions the agent can speak to at all. */
export function agentObservableEvidence() {
  return AGENT_EVIDENCE_MAP.filter(m => !m.informationalOnly).map(m => m.evidence);
}
