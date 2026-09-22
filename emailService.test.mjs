// emailService.test.mjs — run: node emailService.test.mjs
//
// emailService.js resolves everything from process.env at module-load time
// as module-level state, not through an exported pure function — so testing
// different env-var combinations means re-importing the module fresh each
// time. A plain re-import of the same specifier hits Node's ESM module
// cache and returns the SAME already-initialized instance; a cache-busting
// query string forces a genuinely fresh evaluation per scenario.

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const ENV_KEYS = ["EMAIL_PROVIDER", "MAILGUN_API_KEY", "MAILGUN_DOMAIN", "EMAIL_FROM_DOMAIN", "MAILGUN_REGION", "RESEND_API_KEY"];
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setEnv(vars) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}
let n = 0;
async function freshImport() {
  n++;
  return import(`./emailService.js?instance=${n}`);
}

console.log("THE BUG: MAILGUN_DOMAIN set alone must resolve the from-domain to match it:");
{
  setEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "key-123", MAILGUN_DOMAIN: "mg.xandultd.com" });
  const mod = await freshImport();
  const health = mod.getEmailHealth();
  ok(health.configured === true, "Mailgun reports configured with just the API key + domain set");
  ok(health.fromDomain === "mg.xandultd.com",
     `from-domain defaults to MAILGUN_DOMAIN when EMAIL_FROM_DOMAIN is unset (got "${health.fromDomain}")`);
  ok(health.providerDomain === "mg.xandultd.com", "providerDomain (what Mailgun authenticates against) matches");
  ok(health.fromDomain === health.providerDomain,
     "from-domain and provider-domain AGREE — this is exactly what was broken before the fix");
}

console.log("\nAn explicit EMAIL_FROM_DOMAIN still wins over MAILGUN_DOMAIN:");
{
  setEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_API_KEY: "key-123", MAILGUN_DOMAIN: "mg.xandultd.com", EMAIL_FROM_DOMAIN: "mail.xandultd.com" });
  const mod = await freshImport();
  const health = mod.getEmailHealth();
  ok(health.fromDomain === "mail.xandultd.com", `explicit override respected (got "${health.fromDomain}")`);
  ok(health.providerDomain === "mg.xandultd.com", "provider (auth) domain is unaffected by the override");
}

console.log("\nResend is unaffected by any of this (no MAILGUN_DOMAIN concept):");
{
  setEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re-123" });
  const mod = await freshImport();
  const health = mod.getEmailHealth();
  ok(health.provider === "resend" && health.configured === true, "Resend configures normally");
  ok(health.fromDomain === "simulate.shieldai.io", "Resend keeps the plain default from-domain");
  ok(health.providerDomain === null, "no providerDomain concept for Resend");
}

console.log("\nNo API key at all -> not configured, sendEmail says so instead of throwing:");
{
  setEnv({ EMAIL_PROVIDER: "mailgun", MAILGUN_DOMAIN: "mg.xandultd.com" });
  const mod = await freshImport();
  ok(mod.emailConfigured() === false, "reports not configured with no API key");
  const result = await mod.sendEmail({ to: "a@b.com", subject: "hi", text: "hi" });
  ok(result.ok === false && /MAILGUN_API_KEY/.test(result.error), "sendEmail explains what's missing rather than throwing");
}

restoreEnv();
console.log(fail === 0 ? "\nEmail service domain resolution verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
