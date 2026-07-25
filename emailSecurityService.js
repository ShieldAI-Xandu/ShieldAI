// emailSecurityService.js
// Checks whether a client's email domain is hardened against spoofing —
// SPF, DKIM, DMARC, and what mail provider they're on. This is the single
// most common way a "regular" (non-technical) SMB actually gets hit:
// business email compromise, not sophisticated malware. Every check here is
// a plain public DNS lookup — no agent, no client-side install, nothing the
// client has to do first. It reuses the domain already on file for breach
// monitoring (domainService.js) rather than asking for a second one.
//
// HONESTY ABOUT DKIM — READ BEFORE TRUSTING A "NOT FOUND" RESULT
// -----------------------------------------------------------------
// SPF and DMARC live at well-known, fixed DNS locations, so "not found"
// really means not found. DKIM does not: the record lives at
// "{selector}._domainkey.{domain}", and the selector is an arbitrary string
// chosen by whichever mail platform sends for that domain — there is no DNS
// query that enumerates it. The only fully reliable way to learn a domain's
// real DKIM selector is to receive an actual message from it and read the
// DKIM-Signature header. Short of that, this checks a curated list of
// selectors used by default by the major providers (prioritized using the
// MX lookup to guess which provider that likely is). A "found" result here
// is a real, verified finding. A "not found" result means "not found under
// the selectors we know to check" — genuinely weaker evidence, and the
// report says so explicitly rather than implying a clean scan.
//
// No scoring here. This is deliberately kept separate from the NIST posture
// score, same reasoning as securityChecklist.js's "why some questions carry
// scoring:false" — mixing it in would silently re-weight a number the whole
// product treats as fixed and explainable.

import dns from "dns/promises";

// ── Robust TXT resolution ────────────────────────────────────────
// Apex domains accumulate TXT records over the years — Google/Microsoft
// site verification, 1Password, various SaaS tools, SPF itself — and a
// domain with a couple dozen TXT records produces a response too large for
// a single UDP packet, requiring TCP fallback. That fallback doesn't always
// work cleanly in every network path. Rather than let a well-established
// domain's SPF check fail with "unknown" purely because it happens to also
// verify itself with five other SaaS tools, this retries via DNS-over-HTTPS
// (a plain HTTPS request, immune to the UDP/TCP DNS issue) before giving up.
// Genuine "no such record" (ENOTFOUND/ENODATA) is never retried — that's a
// real answer, not a transport failure.
function parseDohTxtChunks(raw) {
  const matches = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (!matches.length) return raw.replace(/^"|"$/g, "");
  return matches.map(m => m[1].replace(/\\"/g, '"')).join("");
}

async function resolveTxtViaDoH(name) {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
  });
  if (!res.ok) throw Object.assign(new Error(`DNS-over-HTTPS query failed (${res.status})`), { code: "EDOH" });
  const data = await res.json();
  if (data.Status !== 0 || !Array.isArray(data.Answer)) return [];
  return data.Answer.filter(a => a.type === 16).map(a => [parseDohTxtChunks(a.data)]);
}

async function resolveTxtRobust(name) {
  try {
    return await dns.resolveTxt(name);
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") throw err; // a real answer, not a failure to retry
    return await resolveTxtViaDoH(name);
  }
}

// ── Provider fingerprinting from MX records ────────────────────
// Purely to (a) give the client a plain-language "you're on X" fact and
// (b) prioritize which DKIM selectors are worth trying first.
const MX_FINGERPRINTS = [
  { id: "google",     label: "Google Workspace / Gmail", match: /google\.com$|googlemail\.com$/i, selectors: ["google"] },
  { id: "microsoft",  label: "Microsoft 365 / Outlook",  match: /outlook\.com$|protection\.outlook\.com$/i, selectors: ["selector1", "selector2"] },
  { id: "proofpoint", label: "Proofpoint",               match: /pphosted\.com$/i, selectors: ["pp", "pp1", "pp2"] },
  { id: "mimecast",   label: "Mimecast",                 match: /mimecast\.com$/i, selectors: ["mimecast", "mimecast1", "mimecast2"] },
];

// Generic fallback selectors worth trying regardless of detected provider —
// common defaults across smaller ESPs, website builders, and CRM/marketing
// tools that also send authenticated mail for a domain (Mailchimp, HubSpot,
// generic cPanel/Plesk hosting defaults, etc.).
const GENERIC_SELECTORS = ["default", "dkim", "mail", "s1", "s2", "k1", "smtp", "email"];

function fingerprintMx(mxHosts) {
  for (const fp of MX_FINGERPRINTS) {
    if (mxHosts.some(h => fp.match.test(h))) return fp;
  }
  return null;
}

// ── SPF ─────────────────────────────────────────────────────────
async function checkSpf(domain) {
  try {
    const records = await withTimeout(resolveTxtRobust(domain), 10000);
    const flat = records.map(chunks => chunks.join(""));
    const spf = flat.filter(v => /^v=spf1/i.test(v.trim()));
    if (spf.length === 0) {
      return {
        status: "missing",
        summary: "No SPF record found.",
        detail: "Without SPF, any mail server can claim to send email as your domain, and receiving mail servers have no way to check whether that claim is legitimate.",
        remediation: `Add a TXT record at ${domain} with a value like: v=spf1 include:_spf.google.com ~all (adjust the include: to match your actual mail provider — check with them for the exact value).`,
      };
    }
    if (spf.length > 1) {
      return {
        status: "warning",
        summary: `${spf.length} SPF records found — only one is allowed.`,
        detail: "Multiple SPF TXT records at the same domain is invalid per the SPF specification, and mail servers may treat this as a failure or ignore SPF entirely for your domain, even though something is technically published.",
        remediation: "Merge these into a single TXT record with one v=spf1 value covering every legitimate sender.",
        found: spf,
      };
    }
    const record = spf[0].trim();
    const allMatch = record.match(/([-~?+])all\s*$/);
    const qualifier = allMatch ? allMatch[1] : null;
    if (qualifier === "-") {
      return { status: "good", summary: "SPF is present and strict (-all).", detail: "Mail servers are told to reject anything not explicitly authorized — the strongest SPF setting.", found: record };
    }
    if (qualifier === "~") {
      return { status: "good", summary: "SPF is present (~all, soft fail).", detail: "Unauthorized senders are flagged as suspicious rather than hard-rejected. Common and reasonable; -all is stricter if your mail provider supports it cleanly.", found: record };
    }
    if (qualifier === "+" || qualifier === "?") {
      return {
        status: "warning",
        summary: `SPF is present but set to ${qualifier === "+" ? "+all (pass everyone)" : "?all (neutral)"}.`,
        detail: qualifier === "+"
          ? "This tells receiving mail servers to accept mail from ANY source claiming to be your domain — it provides no real protection."
          : "A neutral policy gives receiving mail servers no guidance at all — it's barely better than no SPF record.",
        remediation: "Change the final mechanism to ~all or -all once you've confirmed every legitimate sending source is listed.",
        found: record,
      };
    }
    return { status: "warning", summary: "SPF record found but couldn't be fully parsed.", detail: "It doesn't end in a recognized all-mechanism — worth a manual look.", found: record };
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return { status: "missing", summary: "No SPF record found.", detail: "No TXT records at all were found for this domain.", remediation: `Add a TXT record at ${domain} — check with your email provider for the exact value.` };
    }
    return { status: "unknown", summary: "Could not check SPF.", detail: `DNS lookup failed (${err.code || err.message}).` };
  }
}

// ── DMARC ───────────────────────────────────────────────────────
async function checkDmarc(domain) {
  try {
    const records = await withTimeout(resolveTxtRobust(`_dmarc.${domain}`), 10000);
    const flat = records.map(chunks => chunks.join(""));
    const dmarc = flat.find(v => /^v=DMARC1/i.test(v.trim()));
    if (!dmarc) {
      return {
        status: "missing",
        summary: "No DMARC record found.",
        detail: "Without DMARC, even a well-configured SPF/DKIM setup has no enforcement policy — receiving mail servers have no instruction on what to do with mail that fails those checks, and you get no visibility into spoofing attempts against your domain.",
        remediation: `Add a TXT record at _dmarc.${domain} with a value like: v=DMARC1; p=quarantine; rua=mailto:your-reports-address@${domain}`,
      };
    }
    const policyMatch = dmarc.match(/p=(\w+)/i);
    const policy = policyMatch ? policyMatch[1].toLowerCase() : null;
    const hasRua = /rua=/i.test(dmarc);
    if (policy === "reject") {
      return { status: "good", summary: "DMARC is present with p=reject — the strongest policy.", detail: hasRua ? "Aggregate reporting is also configured." : "No reporting address (rua) configured — you won't see visibility reports on spoofing attempts, but the enforcement itself is solid.", found: dmarc };
    }
    if (policy === "quarantine") {
      return { status: "good", summary: "DMARC is present with p=quarantine.", detail: "Failing mail gets sent to spam rather than rejected outright — a reasonable, common policy. p=reject is stricter once you're confident nothing legitimate is being caught.", found: dmarc };
    }
    if (policy === "none") {
      return {
        status: "warning",
        summary: "DMARC is present but set to p=none (monitor only).",
        detail: "This is the correct first step when rolling out DMARC — it collects reports without affecting delivery — but it provides no actual protection against spoofing until moved to quarantine or reject.",
        remediation: "Once you've reviewed a few weeks of reports and confirmed no legitimate mail is misclassified, move to p=quarantine.",
        found: dmarc,
      };
    }
    return { status: "warning", summary: "DMARC record found but the policy couldn't be parsed.", found: dmarc };
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return { status: "missing", summary: "No DMARC record found.", detail: `No TXT record at _dmarc.${domain}.`, remediation: `Add a TXT record at _dmarc.${domain} — see remediation above.` };
    }
    return { status: "unknown", summary: "Could not check DMARC.", detail: `DNS lookup failed (${err.code || err.message}).` };
  }
}

// ── MX / provider fingerprint ────────────────────────────────────
async function checkMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return { status: "missing", summary: "No MX records found — this domain may not receive email at all.", hosts: [] };
    const hosts = mx.sort((a, b) => a.priority - b.priority).map(r => r.exchange);
    const fp = fingerprintMx(hosts);
    return {
      status: "good",
      summary: fp ? `Mail is hosted by ${fp.label}.` : "Mail hosting provider detected, but not one we recognize automatically.",
      hosts,
      providerId: fp?.id || null,
    };
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
      return { status: "missing", summary: "No MX records found — this domain may not receive email at all.", hosts: [] };
    }
    return { status: "unknown", summary: "Could not check MX records.", detail: `DNS lookup failed (${err.code || err.message}).`, hosts: [] };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timed out"), { code: "ETIMEOUT" })), ms)),
  ]);
}

// ── DKIM (best-effort — see header note) ─────────────────────────
// Each selector guess gets a short, hard timeout. This is exploratory
// probing across several selectors that mostly don't exist for a given
// domain — DNS/DoH resolution time for a genuine "not found" can vary by
// network path, and letting even one slow non-answer stall the whole scan
// defeats the point of this being a fast, self-serve dashboard check.
async function checkDkim(domain, providerId) {
  const fp = MX_FINGERPRINTS.find(f => f.id === providerId);
  const priority = fp?.selectors || [];
  const selectors = [...priority, ...GENERIC_SELECTORS];

  const attempts = await Promise.allSettled(
    selectors.map(async selector => {
      const records = await withTimeout(resolveTxtRobust(`${selector}._domainkey.${domain}`), 4000);
      const flat = records.map(chunks => chunks.join(""));
      const dkim = flat.find(v => /v=DKIM1|k=rsa|p=/i.test(v));
      if (!dkim) throw new Error("no DKIM-shaped record at this selector");
      return selector;
    })
  );

  const hits = attempts
    .map((r, i) => (r.status === "fulfilled" ? selectors[i] : null))
    .filter(Boolean);

  if (hits.length) {
    // Prefer a provider-specific selector over a generic one if both hit.
    const best = hits.find(s => priority.includes(s)) || hits[0];
    return {
      status: "good",
      summary: `A DKIM record was found under the "${best}" selector.`,
      detail: hits.length > 1
        ? `Also found under: ${hits.filter(s => s !== best).join(", ")}. There may be additional selectors in use that this check didn't try.`
        : "This confirms DKIM signing is set up for at least one selector. There may be additional selectors in use that this check didn't try.",
      selector: best,
    };
  }
  return {
    status: "unknown",
    summary: `No DKIM record found under any of the ${selectors.length} selectors we checked.`,
    detail: "This does NOT confirm DKIM is absent — the selector in actual use may not be one of the common defaults this check tries. The only fully reliable way to confirm DKIM is to check the DKIM-Signature header on a real message from this domain, or ask your mail provider directly which selector they use.",
    checkedSelectors: selectors,
  };
}

/**
 * Run the full scan. Returns each check plus a plain-language overall
 * summary — never a single composite score (see header note on why this
 * stays separate from the NIST posture score).
 */
export async function scanEmailSecurity(domain) {
  const [spf, dmarc, mx] = await Promise.all([checkSpf(domain), checkDmarc(domain), checkMx(domain)]);
  const dkim = await checkDkim(domain, mx.providerId);

  const checks = { spf, dmarc, dkim, mx };
  const goodCount = Object.values(checks).filter(c => c.status === "good").length;
  const missingOrWarning = Object.entries(checks).filter(([, c]) => c.status === "missing" || c.status === "warning");

  return {
    domain,
    scannedAt: new Date().toISOString(),
    checks,
    overallSummary: missingOrWarning.length === 0
      ? "SPF, DKIM, and DMARC all look solid based on what we could check."
      : `${missingOrWarning.length} of 3 email authentication checks need attention: ${missingOrWarning.map(([k]) => k.toUpperCase()).join(", ")}.`,
    goodCount,
  };
}
