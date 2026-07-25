// phishingScenarios.js
// Catalog of simulated phishing email templates for the phishing simulation
// feature. Each scenario is a realistic, professional pretext — deliberately
// NOT exploiting personal fear, health anxiety, job security, or financial
// hardship. Several commercial phishing-simulation vendors have drawn real
// criticism (and internal backlash) for scenarios like fake layoff notices
// or fake bonus announcements; the point of this feature is to build
// awareness, not to upset or humiliate employees, so every scenario here
// stays in "plausible routine business email" territory.
//
// `redFlags` is shown to the employee AFTER they click, on the educational
// reveal page — this is what makes it training rather than a trap. Each
// flag should be something a careful reader could actually have noticed in
// THIS specific email, not a generic phishing-awareness truism.

export const PHISHING_SCENARIOS = [
  {
    id: "password-expiry",
    name: "Password Expiration Notice",
    category: "Account security",
    difficulty: "easy",
    senderName: "IT Help Desk",
    senderLocal: "it-helpdesk",
    subject: "Action required: your password expires in 24 hours",
    preview: "Your account password is set to expire tomorrow. Reset it now to avoid being locked out.",
    bodyHtml: `<p>Hello,</p>
<p>Our records show your network password is set to expire within 24 hours. To avoid losing access to your email and shared files, please confirm your credentials using the secure link below before the deadline.</p>
<p><a href="{{LINK}}" style="color:#0066cc;">Verify My Password Now</a></p>
<p>If you do not confirm within 24 hours, your account will be temporarily locked and you will need to contact IT directly to restore access.</p>
<p>Thank you,<br/>IT Help Desk</p>`,
    redFlags: [
      "Creates urgency with a short, arbitrary deadline (\"24 hours\") to discourage careful reading.",
      "Asks you to \"verify your password\" through a link — a legitimate password reset never asks you to type your current password into an emailed link.",
      "Generic \"Hello\" greeting rather than your actual name — most real IT notices are personalized.",
      "The real move: go directly to your company's login page yourself, or call IT — never click a password link in an unexpected email.",
    ],
  },
  {
    id: "invoice-overdue",
    name: "Overdue Invoice",
    category: "Finance",
    difficulty: "medium",
    senderName: "Billing Department",
    senderLocal: "billing",
    subject: "Invoice #{{RANDNUM}} — payment overdue",
    preview: "This invoice is now 15 days past due. Please review the attached statement and remit payment.",
    bodyHtml: `<p>Dear Accounts Payable,</p>
<p>Our records indicate that invoice #{{RANDNUM}} is now 15 days past due. To avoid a late fee and possible service interruption, please review your account statement and confirm payment as soon as possible.</p>
<p><a href="{{LINK}}" style="color:#0066cc;">View Invoice & Pay Now</a></p>
<p>If payment has already been sent, please disregard this notice.</p>
<p>Regards,<br/>Billing Department</p>`,
    redFlags: [
      "You likely don't recognize this vendor or invoice number — a real overdue invoice references a specific, known relationship.",
      "\"If payment has already been sent, please disregard\" is a classic hedge scammers use so the message reads as plausible either way.",
      "Pressure around a late fee or service interruption is designed to make you click before checking with a colleague.",
      "The real move: verify any invoice through your existing vendor contact or your finance system — never through a link in the email itself.",
    ],
  },
  {
    id: "exec-urgent-request",
    name: "Urgent Request From Leadership",
    category: "Business email compromise",
    difficulty: "hard",
    senderName: "{{EXEC_NAME}}",
    senderLocal: "office",
    subject: "Quick favor",
    preview: "Are you at your desk? I need you to handle something for me before my next meeting.",
    bodyHtml: `<p>Hi,</p>
<p>Are you available right now? I'm heading into back-to-back meetings and need help with something time-sensitive before I lose signal. Can you reply here as soon as you see this?</p>
<p>Thanks,<br/>{{EXEC_NAME}}</p>
<p><a href="{{LINK}}" style="color:#0066cc;">Reply / View Details</a></p>`,
    redFlags: [
      "No specific ask — vague urgency (\"a quick favor,\" \"time-sensitive\") is meant to make you reply before thinking it through.",
      "The tone and request to bypass normal channels (\"reply here,\" \"before I lose signal\") is a classic executive-impersonation pattern.",
      "Real leadership requests for anything involving money, gift cards, or sensitive data go through established channels — not a one-line email.",
      "The real move: verify by phone or in person using a number you already have on file, never one provided in the email.",
    ],
  },
  {
    id: "package-delivery",
    name: "Delivery Notification",
    category: "General",
    difficulty: "easy",
    senderName: "Shipping Notifications",
    senderLocal: "delivery-alerts",
    subject: "We could not deliver your package",
    preview: "Delivery attempt failed. Please confirm your address to reschedule.",
    bodyHtml: `<p>We attempted to deliver a package to your address today, but were unable to complete delivery.</p>
<p>Please confirm your details to reschedule delivery within 3 business days, or the package will be returned to sender.</p>
<p><a href="{{LINK}}" style="color:#0066cc;">Reschedule Delivery</a></p>`,
    redFlags: [
      "No carrier name, tracking number, or sender is mentioned — real delivery notices always include these specifics.",
      "You may not be expecting any package at all — a moment's pause would have caught this.",
      "\"Confirm your details\" is a common pretext to harvest a name, address, and sometimes payment information.",
      "The real move: check tracking directly on the carrier's own site or app, never through a link in an unsolicited email.",
    ],
  },
  {
    id: "shared-document",
    name: "Shared Document Notification",
    category: "General",
    difficulty: "medium",
    senderName: "Document Sharing",
    senderLocal: "notifications",
    subject: "{{COLLEAGUE_HINT}} shared a document with you",
    preview: "A file has been shared with you. Click to view.",
    bodyHtml: `<p>A document titled <strong>"Q3 Budget Review — Final.xlsx"</strong> has been shared with you.</p>
<p><a href="{{LINK}}" style="color:#0066cc;">View Document</a></p>
<p>This link will expire in 48 hours.</p>`,
    redFlags: [
      "You weren't expecting this document, and the sender isn't a specific known colleague — just a generic \"Document Sharing\" system.",
      "An artificial expiration (\"48 hours\") is designed to make you click before verifying with the supposed sender.",
      "Real file-share notifications usually name the actual person who shared it, not a system account.",
      "The real move: message the colleague directly to confirm before opening anything you weren't expecting.",
    ],
  },
  {
    id: "benefits-enrollment",
    name: "Benefits Enrollment Reminder",
    category: "HR",
    difficulty: "medium",
    senderName: "HR Benefits Team",
    senderLocal: "benefits",
    subject: "Reminder: open enrollment closes Friday",
    preview: "You have not yet completed your benefits enrollment for this year. Action is required by Friday.",
    bodyHtml: `<p>This is a reminder that open enrollment for this year's benefits closes this Friday.</p>
<p>Our records show you have not yet completed your selections. Please log in and confirm your choices to avoid default enrollment.</p>
<p><a href="{{LINK}}" style="color:#0066cc;">Complete Enrollment</a></p>`,
    redFlags: [
      "A real enrollment deadline is usually announced well in advance through multiple channels, not a single surprise email.",
      "\"Avoid default enrollment\" creates pressure around a real financial decision (your benefits) to get a fast click.",
      "The link goes to an unfamiliar address rather than your company's actual HR/benefits portal.",
      "The real move: go directly to your known HR portal by typing the address yourself, not by clicking through an email.",
    ],
  },
];

export function getScenario(id) {
  return PHISHING_SCENARIOS.find(s => s.id === id) || null;
}

export function scenarioSummaries() {
  return PHISHING_SCENARIOS.map(s => ({
    id: s.id, name: s.name, category: s.category, difficulty: s.difficulty, preview: s.preview,
  }));
}

/**
 * Fill the {{LINK}}, {{RANDNUM}}, {{EXEC_NAME}}, {{COLLEAGUE_HINT}} placeholders.
 * execName/colleagueHint are optional and fall back to generic-but-plausible
 * defaults so a campaign works even without per-learner personalization.
 */
export function renderScenario(scenario, { link, execName, colleagueHint }) {
  const randnum = Math.floor(10000 + Math.random() * 89999);
  const subs = {
    "{{LINK}}": link,
    "{{RANDNUM}}": String(randnum),
    "{{EXEC_NAME}}": execName || "Your Manager",
    "{{COLLEAGUE_HINT}}": colleagueHint || "A colleague",
  };
  let subject = scenario.subject, html = scenario.bodyHtml, senderName = scenario.senderName;
  for (const [k, v] of Object.entries(subs)) {
    subject = subject.split(k).join(v);
    html = html.split(k).join(v);
    senderName = senderName.split(k).join(v);
  }
  return { subject, html, senderName };
}
