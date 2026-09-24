// The product's name, server-side. The UI draws it as "ShieldAI" with a small
// "vCISO" subscript; BRAND_PLAIN is the plain-text form for places a subscript
// is impossible: email subjects and sender names, calendar names, report
// footers, AI prompts, default branding. Keep in sync with BRAND_PLAIN in
// src/App.jsx.
//
// This is display text only. Identifiers are NOT the brand and never change:
// URLs and email addresses, env var names, the `ShieldAI_` download-filename
// prefix, installer/service/task names, ICS PRODID, localStorage keys.
export const BRAND_PLAIN = "ShieldAI vCISO";
