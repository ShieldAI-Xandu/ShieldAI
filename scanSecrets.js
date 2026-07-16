#!/usr/bin/env node
// scanSecrets.js
// Finds credentials committed to the repo, staged for commit, or sitting in
// files that are easy to hand to someone by accident (uploads, .txt notes,
// backups). Run it before pushing, and before sharing files with anyone.
//
//   node scanSecrets.js              scan the working tree
//   node scanSecrets.js --staged     scan only what's staged (use in a hook)
//   node scanSecrets.js --history    also scan git history (slow, thorough)
//   node scanSecrets.js --quiet      only print findings
//
// Exit code 1 if anything is found, so it works as a pre-commit hook:
//   echo 'node scanSecrets.js --staged' > .git/hooks/pre-commit
//   chmod +x .git/hooks/pre-commit
//
// This is deliberately conservative: it errs toward false positives, because a
// missed key is expensive and a false positive costs ten seconds.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const ARGS = new Set(process.argv.slice(2));
const QUIET = ARGS.has("--quiet");
const STAGED_ONLY = ARGS.has("--staged");
const SCAN_HISTORY = ARGS.has("--history");

// ── What a secret looks like ──────────────────────────────────
// Patterns are anchored on provider-specific prefixes where possible; generic
// entropy checks produce too much noise to be useful.
const PATTERNS = [
  { id: "anthropic", name: "Anthropic API key", severity: "critical",
    re: /sk-ant-[A-Za-z0-9_\-]{20,}/g,
    rotate: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI API key", severity: "critical",
    re: /sk-(?!ant-)[A-Za-z0-9_\-]{20,}/g,
    rotate: "https://platform.openai.com/api-keys" },
  { id: "google", name: "Google/Gemini API key", severity: "critical",
    re: /\b(?:AIza[0-9A-Za-z_\-]{35}|AQ\.[A-Za-z0-9_\-]{20,})/g,
    rotate: "https://aistudio.google.com/apikey" },
  { id: "stripe_live", name: "Stripe LIVE secret key", severity: "critical",
    re: /sk_live_[A-Za-z0-9]{20,}/g,
    rotate: "https://dashboard.stripe.com/apikeys" },
  { id: "stripe_test", name: "Stripe test secret key", severity: "high",
    re: /sk_test_[A-Za-z0-9]{20,}/g,
    rotate: "https://dashboard.stripe.com/test/apikeys" },
  { id: "stripe_whsec", name: "Stripe webhook secret", severity: "high",
    re: /whsec_[A-Za-z0-9]{20,}/g,
    rotate: "https://dashboard.stripe.com/webhooks" },
  { id: "hibp", name: "Have I Been Pwned API key", severity: "high",
    re: /\bHIBP_API_KEY\s*[=:]\s*["']?([a-f0-9]{32})\b/gi,
    rotate: "https://haveibeenpwned.com/API/Key" },
  { id: "aws", name: "AWS access key ID", severity: "critical",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    rotate: "https://console.aws.amazon.com/iam/home#/security_credentials" },
  { id: "github", name: "GitHub token", severity: "critical",
    re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
    rotate: "https://github.com/settings/tokens" },
  { id: "private_key", name: "Private key block", severity: "critical",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    rotate: "Regenerate the key pair and revoke the old one." },
  { id: "jwt_secret", name: "Hardcoded JWT secret", severity: "high",
    re: /\b(?:JWT_SECRET|DEMO_JWT_SECRET)\s*[=:]\s*["']([^"'\s]{12,})["']/g,
    rotate: "Set a new value in your host's environment variables.",
    // A fallback like `process.env.JWT_SECRET || "dev-only"` is a code smell,
    // not a leaked credential — don't cry wolf about it.
    ignoreIf: (line) => /process\.env\./.test(line) },
];

// Files whose very existence is a risk, regardless of content.
// `.env.example` / `.env.sample` / `.env.template` exist precisely to BE
// committed — they document the shape without the values. Flagging them trains
// people to ignore the scanner.
const TEMPLATE_ENV = /^\.env\.(example|sample|template|dist)$/i;

const RISKY_FILENAMES = [
  { re: /^\.env(\..+)?$/i, why: "Environment file — must never be committed or shared." },
  { re: /^_env$/i, why: "Environment file renamed to dodge .gitignore — the secrets inside are still real." },
  { re: /(^|[._-])key(s)?\.(txt|json|md)$/i, why: "Looks like a file of credentials kept in plain text." },
  { re: /(^|[._-])secret(s)?\.(txt|json|ya?ml)$/i, why: "Looks like a secrets file." },
  { re: /\.pem$|\.p12$|\.pfx$|id_rsa$/i, why: "Private key material." },
  { re: /\.env\.backup$|\.env\.bak$/i, why: "Backup of an environment file." },
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".cache", "testdata", ".vscode", ".idea",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".mp3", ".docx", ".xlsx", ".pptx",
]);
const MAX_BYTES = 2 * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────
const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  amber: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// Never print a live secret. Showing enough to identify it is the whole job;
// showing the rest just moves the leak into your terminal scrollback.
function mask(secret) {
  const s = String(secret);
  if (s.length <= 10) return s.slice(0, 2) + "•".repeat(6);
  return `${s.slice(0, 6)}${"•".repeat(Math.min(s.length - 10, 20))}${s.slice(-4)}`;
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function gitStagedFiles() {
  try {
    return execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
      .split("\n").map(f => f.trim()).filter(Boolean).map(f => path.join(ROOT, f));
  } catch { return []; }
}

function isTracked(file) {
  try {
    execSync(`git ls-files --error-unmatch "${path.relative(ROOT, file)}"`,
      { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function gitAvailable() {
  try { execSync("git rev-parse --git-dir", { stdio: "ignore" }); return true; }
  catch { return false; }
}

// ── Scanning ──────────────────────────────────────────────────
function scanFile(file) {
  const findings = [];
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) return findings;
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) return findings;

    const rel = path.relative(ROOT, file);
    const base = path.basename(file);

    // Risky by name, before we even look inside.
    for (const rf of RISKY_FILENAMES) {
      if (TEMPLATE_ENV.test(base)) break;   // templates are meant to be committed
      if (rf.re.test(base)) {
        findings.push({ type: "file", file: rel, severity: "high", name: "Risky file", detail: rf.why });
        break;
      }
    }

    const text = fs.readFileSync(file, "utf8");
    if (text.includes("\0")) return findings; // binary

    const lines = text.split("\n");
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        const upto = text.slice(0, m.index);
        const lineNo = upto.split("\n").length;
        const line = lines[lineNo - 1] || "";
        if (p.ignoreIf && p.ignoreIf(line)) continue;
        // A masked/placeholder value isn't a leak.
        if (/•|\bREDACTED\b|<your|xxxx|placeholder|example/i.test(m[0])) continue;
        findings.push({
          type: "secret", file: rel, line: lineNo, severity: p.severity,
          name: p.name, id: p.id, masked: mask(m[1] || m[0]), rotate: p.rotate,
        });
      }
    }
  } catch { /* unreadable — skip */ }
  return findings;
}

function scanHistory() {
  if (!gitAvailable()) return [];
  const findings = [];
  if (!QUIET) console.log(C.dim("Scanning git history (this can take a moment)…"));
  try {
    const blobs = execSync("git rev-list --all --objects", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(l => l.includes(" "));
    const seen = new Set();
    for (const line of blobs) {
      const [sha, ...rest] = line.split(" ");
      const name = rest.join(" ");
      if (!name || seen.has(name)) continue;
      if (SKIP_EXT.has(path.extname(name).toLowerCase())) continue;
      if ([...SKIP_DIRS].some(d => name.startsWith(d + "/"))) continue;
      seen.add(name);
      let content = "";
      try { content = execSync(`git cat-file -p ${sha}`, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); }
      catch { continue; }
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        const m = p.re.exec(content);
        if (m && !/•|REDACTED|<your|xxxx|placeholder|example/i.test(m[0])) {
          findings.push({ type: "history", file: name, severity: p.severity,
            name: p.name, id: p.id, masked: mask(m[1] || m[0]), rotate: p.rotate });
        }
      }
    }
  } catch (err) {
    if (!QUIET) console.log(C.dim(`  (history scan skipped: ${err.message.split("\n")[0]})`));
  }
  return findings;
}

// ── Run ───────────────────────────────────────────────────────
const files = STAGED_ONLY ? gitStagedFiles() : walk(ROOT);
let findings = files.flatMap(scanFile);
if (SCAN_HISTORY) findings = findings.concat(scanHistory());

// Flag anything tracked by git separately — that's the difference between "on
// your laptop" and "published".
if (gitAvailable() && !STAGED_ONLY) {
  for (const f of findings) {
    if (f.type !== "history") {
      try { f.tracked = isTracked(path.join(ROOT, f.file)); } catch { f.tracked = false; }
    }
  }
}

if (!QUIET) {
  console.log(C.bold("\nShieldAI secret scan"));
  console.log(C.dim(`  ${STAGED_ONLY ? "staged files" : `${files.length} files`}${SCAN_HISTORY ? " + git history" : ""}\n`));
}

if (findings.length === 0) {
  console.log(C.green("✔ No secrets found."));
  if (!SCAN_HISTORY && !STAGED_ONLY && !QUIET) {
    console.log(C.dim("  Tip: run with --history to also check past commits."));
  }
  process.exit(0);
}

const order = { critical: 0, high: 1, medium: 2 };
findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

const tracked = findings.filter(f => f.tracked);
const history = findings.filter(f => f.type === "history");

for (const f of findings) {
  const tag = f.severity === "critical" ? C.red("CRITICAL") : C.amber(f.severity.toUpperCase());
  const where = f.type === "history" ? C.red(" [IN GIT HISTORY]") : f.tracked ? C.red(" [TRACKED BY GIT]") : "";
  console.log(`${tag}  ${C.bold(f.name)}${where}`);
  console.log(`  ${f.file}${f.line ? `:${f.line}` : ""}`);
  if (f.masked) console.log(`  value: ${C.dim(f.masked)}`);
  if (f.detail) console.log(`  ${C.dim(f.detail)}`);
  if (f.rotate) console.log(`  rotate: ${C.dim(f.rotate)}`);
  console.log("");
}

console.log(C.bold(`${findings.length} finding${findings.length === 1 ? "" : "s"}.`));
if (tracked.length || history.length) {
  console.log(C.red(`\n⚠ ${tracked.length + history.length} are in git — treat those credentials as compromised and rotate them.`));
  if (history.length) {
    console.log(C.dim("  Secrets in history stay there after deletion. Rotating is the fix; rewriting history is not."));
  }
}
process.exit(1);
