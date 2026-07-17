// pciDss.js
// PCI DSS v4.0.1 — Payment Card Industry Data Security Standard.
//
// VERSION — v4.0.1, and this matters
// -----------------------------------
// v4.0.1 is current. All 51 "future-dated" requirements that v4.0 introduced as
// best practices became MANDATORY on 31 March 2025. There is no grace period
// left: any assessment in 2026 treats them as required. A tool still describing
// them as "best practice" is giving 2024 advice.
//
// WHY SAQ SCOPING IS THE WHOLE DESIGN
// ------------------------------------
// PCI DSS is 12 requirements and roughly 250 sub-requirements — but almost no
// SMB is responsible for all of them. The Self-Assessment Questionnaire you
// file, which is determined by HOW you take payments, defines which
// requirements apply to you. A dental practice using a hosted payment page
// files SAQ A: about 30 controls, not 250.
//
// So showing an SMB all 250 requirements is not thoroughness — it's noise that
// makes the product look broken and buries the ~30 things they must actually
// do. Every requirement below carries an `saq` list naming which questionnaires
// it appears in, and `assessPciDss()` filters to the client's actual profile.
//
// We hold the full standard AND scope it. Both, not either.
//
// ENFORCEMENT — this is a contract, not a law
// --------------------------------------------
// PCI DSS is not legislation. It's a contractual obligation enforced by the
// card brands through your acquiring bank, which can levy fines, impose
// monitoring, or withdraw your ability to accept cards. That's a commercial
// death sentence for a small merchant, which is why "it's not the law" is a
// dangerous thing for anyone to conclude.
//
// COPYRIGHT
// ---------
// The standard is published by the PCI Security Standards Council and is
// copyrighted. We reference requirement NUMBERS (8.3.1, 3.4.1) and describe
// what each covers in OUR OWN WORDS. We do not reproduce PCI SSC text. Do not
// paste the standard's wording into this file.
//
// Sources:
//   PCI SSC Document Library — https://www.pcisecuritystandards.org/document_library/
//   SAQ Instructions and Guidelines v4.x — PCI SSC

export const PCI_META = {
  id: "pci-dss",
  name: "PCI DSS",
  shortName: "PCI DSS",
  fullName: "Payment Card Industry Data Security Standard",
  version: "v4.0.1",
  authority: "PCI Security Standards Council",
  url: "https://www.pcisecuritystandards.org",
  documentLibrary: "https://www.pcisecuritystandards.org/document_library/",
  depth: "control-mapped",
  summary:
    "The security standard every business that takes card payments must meet. Which parts apply to you depends entirely on how you accept payments — most small merchants are responsible for a small fraction of the standard.",
  whoMustComply:
    "Any entity that stores, processes, or transmits cardholder data — regardless of size. A one-person shop taking cards is in scope.",
  enforcement:
    "Not a law. A contractual obligation enforced by the card brands via your acquiring bank, which can impose fines, force monitoring, or revoke card acceptance entirely.",
  versionNote:
    "v4.0.1 is current. The 51 requirements v4.0 introduced as future-dated best practices became mandatory on 31 March 2025 — there is no grace period remaining.",
  keyPoint:
    "Scope is everything. Reducing what touches cardholder data — a hosted payment page, tokenization, a P2PE terminal — is far cheaper than securing a large environment. The best PCI strategy is usually to be responsible for less of it.",
};

// ── The six control objectives ────────────────────────────────
export const PCI_OBJECTIVES = [
  { id: "network", name: "Build and Maintain a Secure Network and Systems", requirements: [1, 2] },
  { id: "data", name: "Protect Account Data", requirements: [3, 4] },
  { id: "vuln", name: "Maintain a Vulnerability Management Program", requirements: [5, 6] },
  { id: "access", name: "Implement Strong Access Control Measures", requirements: [7, 8, 9] },
  { id: "monitor", name: "Regularly Monitor and Test Networks", requirements: [10, 11] },
  { id: "policy", name: "Maintain an Information Security Policy", requirements: [12] },
];

// ── SAQ types ─────────────────────────────────────────────────
// Nine questionnaires. The right one is the one matching how card data actually
// enters, moves through, and leaves the environment. Choosing wrong is a common
// and expensive mistake — it surfaces during a breach investigation or acquirer
// review, exactly when you least want it.
export const PCI_SAQ_TYPES = {
  A: {
    id: "A",
    name: "SAQ A",
    forWho: "Card-not-present merchants who have fully outsourced all cardholder data handling to PCI-compliant third parties.",
    criteria: [
      "E-commerce or mail/telephone-order only — no card-present transactions",
      "All payment processing is outsourced to a validated PCI DSS compliant provider",
      "Your website either redirects to the provider or embeds their payment page (iframe)",
      "You never store, process, or transmit cardholder data on your systems",
      "Any cardholder data you retain is on paper only",
    ],
    example: "A dental practice whose website links out to a hosted payment page.",
    burden: "smallest",
    note: "This is where most small merchants belong, and where they should try to get to. If you're not eligible, changing how you take payments is often cheaper than complying with a larger SAQ.",
  },
  A_EP: {
    id: "A-EP",
    name: "SAQ A-EP",
    forWho: "E-commerce merchants who outsource payment processing but whose own website can affect the security of the transaction.",
    criteria: [
      "E-commerce only",
      "Payment processing outsourced to a validated PCI DSS compliant provider",
      "Your site does not receive cardholder data but DOES affect the payment transaction — e.g. Direct Post (HTTP POST) or a JavaScript-created form",
      "You do not store cardholder data electronically",
    ],
    example: "An online store using a Direct Post integration rather than a full redirect.",
    burden: "large",
    note: "Substantially heavier than SAQ A. If you're here, moving to a redirect or iframe integration can drop you to SAQ A — usually the single highest-value PCI decision an e-commerce SMB can make.",
  },
  B: {
    id: "B",
    name: "SAQ B",
    forWho: "Merchants using standalone dial-up terminals or imprint machines with no internet connection.",
    criteria: [
      "Standalone, dial-out terminals or manual imprint machines only",
      "No internet connection on the payment terminals",
      "No electronic storage of cardholder data",
    ],
    example: "A small clinic with an old dial-up card terminal.",
    burden: "small",
  },
  B_IP: {
    id: "B-IP",
    name: "SAQ B-IP",
    forWho: "Merchants using standalone, PTS-approved payment terminals with an IP connection.",
    criteria: [
      "Standalone PCI PTS-approved payment terminals with an IP connection to the processor",
      "Terminals are not connected to any other system in your environment",
      "No electronic storage of cardholder data",
    ],
    example: "A café with a network-connected card terminal that isn't integrated with the till.",
    burden: "medium",
  },
  C: {
    id: "C",
    name: "SAQ C",
    forWho: "Merchants with a payment application connected to the internet, no electronic cardholder data storage.",
    criteria: [
      "Payment application system and internet connection on the same device or LAN",
      "The payment system is not connected to other systems in your environment",
      "The physical location is not connected to other premises",
      "No electronic storage of cardholder data",
    ],
    example: "A small retailer with an integrated internet-connected POS.",
    burden: "large",
    note: "Not applicable to e-commerce. Substantially longer than SAQ B-IP because your POS, network, and supporting infrastructure are all in scope.",
  },
  C_VT: {
    id: "C-VT",
    name: "SAQ C-VT",
    forWho: "Merchants keying transactions one at a time into a web-based virtual terminal.",
    criteria: [
      "Manual entry of a single transaction at a time via a browser-based virtual terminal",
      "The virtual terminal is operated by a validated PCI DSS compliant provider",
      "The workstation used is isolated and dedicated solely to that purpose — no email, no web browsing",
      "No electronic storage of cardholder data",
    ],
    example: "A law firm keying occasional card payments into their processor's web portal.",
    burden: "medium",
    note: "Not applicable to e-commerce. The dedicated-workstation condition is strict and is where most C-VT claims fail — a machine that also reads email is not eligible.",
  },
  P2PE: {
    id: "P2PE",
    name: "SAQ P2PE",
    forWho: "Merchants using only a validated, PCI-listed Point-to-Point Encryption solution.",
    criteria: [
      "All payment processing via a PCI SSC-listed P2PE solution",
      "No access to clear-text account data on any system",
      "No electronic storage of cardholder data",
      "Any retained account data is on paper only",
    ],
    example: "A pop-up shop using a certified P2PE mobile reader.",
    burden: "smallest",
    note: "The reward for adopting a listed P2PE solution: the encryption happens inside the terminal, so your systems never see readable card data and most of the standard falls out of scope.",
  },
  D_MERCHANT: {
    id: "D-Merchant",
    name: "SAQ D for Merchants",
    forWho: "Any merchant not eligible for another SAQ — typically because they store cardholder data electronically or accept it directly on their website.",
    criteria: [
      "Does not meet the eligibility criteria for any other SAQ type",
      "Commonly: electronic storage of cardholder data, or accepting card data directly on your own site via API",
    ],
    example: "A subscription business storing card details for recurring billing.",
    burden: "largest",
    note: "All 12 requirements apply. If you're here, ask whether you actually need to hold that data — tokenization usually removes the need and drops you to a far smaller SAQ.",
  },
  D_SERVICE: {
    id: "D-Service",
    name: "SAQ D for Service Providers",
    forWho: "Service providers eligible to self-assess.",
    criteria: [
      "You are a service provider handling cardholder data on behalf of others",
      "You are eligible to complete an SAQ rather than a full Report on Compliance",
    ],
    example: "A payment gateway handling card flows for multiple merchants.",
    burden: "largest",
    note: "Service providers have only one SAQ option: D. There are additional service-provider-only requirements throughout the standard.",
  },
};

// ── SAQ selection helper ──────────────────────────────────────
// Deliberately conservative: when the answers are ambiguous we return D
// (the largest scope) rather than guessing small. Under-scoping PCI is the
// expensive error — it surfaces during a breach investigation.
export function suggestSaq({
  isServiceProvider = false,
  storesCardDataElectronically = false,
  channel = null,            // "ecommerce" | "card-present" | "moto"
  ecommerceIntegration = null, // "redirect" | "iframe" | "direct-post" | "js-form" | "api"
  terminalType = null,       // "dial-up" | "ip-standalone" | "integrated-pos" | "virtual-terminal" | "p2pe"
} = {}) {
  if (isServiceProvider) {
    return { saq: "D_SERVICE", confident: true, reason: "Service providers have only one SAQ option: SAQ D." };
  }
  if (storesCardDataElectronically) {
    return {
      saq: "D_MERCHANT", confident: true,
      reason: "Storing cardholder data electronically rules out every other SAQ. Consider whether tokenization would remove the need to store it at all.",
    };
  }
  if (terminalType === "p2pe") {
    return { saq: "P2PE", confident: true, reason: "A validated PCI-listed P2PE solution keeps clear-text card data out of your systems entirely." };
  }
  if (channel === "ecommerce") {
    if (ecommerceIntegration === "redirect" || ecommerceIntegration === "iframe") {
      return { saq: "A", confident: true, reason: "Fully outsourced payment page (redirect or iframe) with no card data touching your systems." };
    }
    if (ecommerceIntegration === "direct-post" || ecommerceIntegration === "js-form") {
      return {
        saq: "A_EP", confident: true,
        reason: "Your site affects the transaction even though it doesn't receive card data. Moving to a redirect or iframe would drop you to SAQ A — usually the highest-value change available to you.",
      };
    }
    if (ecommerceIntegration === "api") {
      return { saq: "D_MERCHANT", confident: true, reason: "Accepting card data directly via API puts your systems in full scope." };
    }
    return { saq: "D_MERCHANT", confident: false, reason: "Tell us how your site takes payments — a redirect or iframe integration would likely put you in SAQ A instead." };
  }
  if (terminalType === "dial-up") {
    return { saq: "B", confident: true, reason: "Standalone dial-out terminals with no internet connection." };
  }
  if (terminalType === "ip-standalone") {
    return { saq: "B_IP", confident: true, reason: "Standalone PTS-approved terminals with an IP connection, not integrated with other systems." };
  }
  if (terminalType === "virtual-terminal") {
    return {
      saq: "C_VT", confident: false,
      reason: "Likely SAQ C-VT — but only if the workstation is isolated and used for nothing else. If that machine also reads email or browses the web, you are not eligible.",
    };
  }
  if (terminalType === "integrated-pos") {
    return { saq: "C", confident: true, reason: "An internet-connected integrated payment application brings your POS and network into scope." };
  }
  return {
    saq: "D_MERCHANT", confident: false,
    reason: "We don't have enough detail about how you take payments, so we're showing the full standard. Answer the payment-channel questions for a scoped view — most small merchants land in SAQ A.",
  };
}

// ── The 12 requirements ───────────────────────────────────────
// Each sub-requirement carries:
//   `saq`      — which questionnaires it appears in. This is what makes the
//                scoping work. "all" means every SAQ type.
//   `evidence` — checklist item IDs giving deterministic signal.
//   `v4new`    — introduced or expanded in v4.0 and mandatory since 31 Mar 2025.
//
// SAQ applicability here reflects the general shape of each questionnaire. The
// authoritative source is the SAQ document itself from PCI SSC — we say so in
// the output rather than implying our mapping is the standard.

const ALL = "all";

export const PCI_REQUIREMENTS = [
  {
    number: 1,
    objective: "network",
    name: "Install and maintain network security controls",
    summary: "Firewalls, cloud security groups, and whatever else stands between your cardholder data and everything else.",
    nistFunctions: ["Protect"],
    note: "v4.0 renamed 'firewalls and routers' to 'network security controls' — the concept now covers cloud security groups, software-defined networking, and zero-trust architecture, not just a box in a rack.",
    subs: [
      { id: "1.1", covers: "Processes and mechanisms for network security controls are defined, documented, and understood", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "1.2", covers: "Network security controls are configured and maintained", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["itManagement"] },
      { id: "1.3", covers: "Network access to and from the cardholder data environment is restricted", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["itManagement"] },
      { id: "1.4", covers: "Network connections between trusted and untrusted networks are controlled", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["itManagement"] },
      { id: "1.5", covers: "Risks to the CDE from computing devices that connect to both untrusted networks and the CDE are mitigated", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["endpoint"] },
    ],
  },
  {
    number: 2,
    objective: "network",
    name: "Apply secure configurations to all system components",
    summary: "Change the defaults. Vendor default passwords and settings are the first thing an attacker tries.",
    nistFunctions: ["Protect"],
    subs: [
      { id: "2.1", covers: "Processes and mechanisms for applying secure configurations are defined and understood", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "2.2", covers: "System components are configured and managed securely — defaults changed, unnecessary services removed", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["itManagement","endpoint"] },
      { id: "2.3", covers: "Wireless environments are configured and managed securely", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["itManagement"] },
    ],
  },
  {
    number: 3,
    objective: "data",
    name: "Protect stored account data",
    summary: "If you don't store it, this requirement mostly disappears. That's the strategy.",
    nistFunctions: ["Protect"],
    note: "v4.0.1 sharpened the distinction between account data, cardholder data, and sensitive authentication data — each requirement applies to a specific type, so read carefully.",
    subs: [
      { id: "3.1", covers: "Processes and mechanisms for protecting stored account data are defined and understood", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies","dataInventory"] },
      { id: "3.2", covers: "Storage of account data is kept to a minimum, with defined retention and disposal", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["dataInventory"] },
      { id: "3.3", covers: "Sensitive authentication data is not retained after authorization", saq: ALL, evidence: ["dataInventory"], v4new: true },
      { id: "3.4", covers: "Access to displays of full PAN and the ability to copy it are restricted", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa","documentedPolicies"] },
      { id: "3.5", covers: "Primary account number is secured wherever it is stored", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["dataInventory"] },
      { id: "3.6", covers: "Cryptographic keys used to protect stored account data are secured", saq: ["A-EP","D-Merchant","D-Service"], evidence: [] },
      { id: "3.7", covers: "Key management processes and procedures are defined and implemented", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
    ],
  },
  {
    number: 4,
    objective: "data",
    name: "Protect cardholder data with strong cryptography during transmission",
    summary: "Card data crossing any open or public network must be encrypted in transit.",
    nistFunctions: ["Protect"],
    subs: [
      { id: "4.1", covers: "Processes and mechanisms for protecting cardholder data in transit are defined and understood", saq: ["A","A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "4.2", covers: "Cardholder data is protected with strong cryptography during transmission over open, public networks", saq: ["A","A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["emailSecurity"] },
    ],
  },
  {
    number: 5,
    objective: "vuln",
    name: "Protect all systems and networks from malicious software",
    summary: "Anti-malware that is actually running, actually current, and actually scanning.",
    nistFunctions: ["Protect","Detect"],
    note: "v4.0 requires anti-malware to be kept current, run periodic scans, and generate audit logs — and adds phishing protection for personnel.",
    subs: [
      { id: "5.1", covers: "Processes and mechanisms for protecting systems from malicious software are defined and understood", saq: ["A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "5.2", covers: "Malicious software is prevented or detected and addressed", saq: ["A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["endpoint"] },
      { id: "5.3", covers: "Anti-malware mechanisms are active, maintained, and monitored", saq: ["A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["endpoint","monitoring"], v4new: true },
      { id: "5.4", covers: "Anti-phishing mechanisms protect users from phishing attacks", saq: ["A-EP","C","C-VT","D-Merchant","D-Service"], evidence: ["emailSecurity","training"], v4new: true },
    ],
  },
  {
    number: 6,
    objective: "vuln",
    name: "Develop and maintain secure systems and software",
    summary: "Patch what you run; build securely what you build.",
    nistFunctions: ["Protect","Identify"],
    note: "v4.0 added payment-page script management (6.4.3) — a direct response to Magecart-style skimming attacks on e-commerce checkout pages.",
    subs: [
      { id: "6.1", covers: "Processes and mechanisms for developing and maintaining secure systems are defined and understood", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "6.2", covers: "Bespoke and custom software is developed securely", saq: ["A-EP","D-Merchant","D-Service"], evidence: [] },
      { id: "6.3", covers: "Security vulnerabilities are identified and addressed", saq: ["A","A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["monitoring","itManagement"] },
      { id: "6.4", covers: "Public-facing web applications are protected against attacks, including management of payment page scripts", saq: ["A-EP","D-Merchant","D-Service"], evidence: [], v4new: true },
      { id: "6.5", covers: "Changes to all system components are managed securely", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies","itManagement"] },
    ],
  },
  {
    number: 7,
    objective: "access",
    name: "Restrict access to system components and cardholder data by business need to know",
    summary: "Least privilege. People get access to card data because their job requires it, not because it's convenient.",
    nistFunctions: ["Protect"],
    subs: [
      { id: "7.1", covers: "Processes and mechanisms for restricting access by business need to know are defined and understood", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "7.2", covers: "Access to system components and data is appropriately defined and assigned", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa","documentedPolicies"] },
      { id: "7.3", covers: "Access to system components and data is managed via an access control system", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["mfa"] },
    ],
  },
  {
    number: 8,
    objective: "access",
    name: "Identify users and authenticate access to system components",
    summary: "Unique IDs for everyone, and MFA for everything that touches the cardholder data environment.",
    nistFunctions: ["Protect"],
    note: "The biggest v4.0 change for small merchants: 8.3.1 extends MFA to ALL user access into the CDE — not just remote and not just administrators. Mandatory since 31 March 2025.",
    subs: [
      { id: "8.1", covers: "Processes and mechanisms for identifying users and authenticating access are defined and understood", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "8.2", covers: "User identification and related accounts are managed throughout their lifecycle", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa","documentedPolicies"] },
      { id: "8.3", covers: "Strong authentication for users and administrators is established and managed", saq: ["A-EP","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa"], v4new: true },
      { id: "8.4", covers: "Multi-factor authentication is implemented to secure access into the CDE", saq: ["A-EP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa"], v4new: true },
      { id: "8.5", covers: "Multi-factor authentication systems are configured to prevent misuse", saq: ["A-EP","C","C-VT","D-Merchant","D-Service"], evidence: ["mfa"], v4new: true },
      { id: "8.6", covers: "Use of application and system accounts and associated authentication factors is managed", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["mfa"], v4new: true },
    ],
  },
  {
    number: 9,
    objective: "access",
    name: "Restrict physical access to cardholder data",
    summary: "Locks, visitor logs, and knowing where your card-reading devices are.",
    nistFunctions: ["Protect"],
    subs: [
      { id: "9.1", covers: "Processes and mechanisms for restricting physical access are defined and understood", saq: ["B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "9.2", covers: "Physical access controls manage entry into facilities and systems containing cardholder data", saq: ["C","D-Merchant","D-Service"], evidence: [] },
      { id: "9.3", covers: "Physical access for personnel and visitors is authorized and managed", saq: ["C","D-Merchant","D-Service"], evidence: [] },
      { id: "9.4", covers: "Media with cardholder data is securely stored, accessed, distributed, and destroyed", saq: ["B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["dataInventory"] },
      { id: "9.5", covers: "Point-of-interaction devices are protected from tampering and unauthorized substitution", saq: ["B","B-IP","C","C-VT","P2PE","D-Merchant","D-Service"], evidence: [] },
    ],
  },
  {
    number: 10,
    objective: "monitor",
    name: "Log and monitor all access to system components and cardholder data",
    summary: "If it isn't logged, it didn't happen — and you'll never reconstruct a breach without it.",
    nistFunctions: ["Detect"],
    subs: [
      { id: "10.1", covers: "Processes and mechanisms for logging and monitoring access are defined and documented", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "10.2", covers: "Audit logs are implemented to support detection of anomalies and forensic analysis", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["monitoring"] },
      { id: "10.3", covers: "Audit logs are protected from destruction and unauthorized modification", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["monitoring"] },
      { id: "10.4", covers: "Audit logs are reviewed to identify anomalies or suspicious activity", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["monitoring"], v4new: true },
      { id: "10.5", covers: "Audit log history is retained and available for analysis", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["monitoring"] },
      { id: "10.6", covers: "Time-synchronization mechanisms support consistent time settings across systems", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: [] },
      { id: "10.7", covers: "Failures of critical security control systems are detected, reported, and responded to promptly", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["monitoring","incidentResponse"], v4new: true },
    ],
  },
  {
    number: 11,
    objective: "monitor",
    name: "Test security of systems and networks regularly",
    summary: "Vulnerability scans quarterly, penetration testing annually, and — new in v4.0 — payment page script integrity.",
    nistFunctions: ["Detect","Identify"],
    note: "11.6.1 is new in v4.0 and specifically targets e-commerce skimming: detect unauthorized changes to your payment page. 11.3.1.2 adds authenticated internal vulnerability scanning.",
    subs: [
      { id: "11.1", covers: "Processes and mechanisms for regularly testing security are defined and understood", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "11.2", covers: "Wireless access points are identified and monitored; unauthorized ones are addressed", saq: ["B-IP","C","D-Merchant","D-Service"], evidence: ["monitoring"] },
      { id: "11.3", covers: "External and internal vulnerabilities are regularly identified, prioritized, and addressed", saq: ["A-EP","B-IP","C","D-Merchant","D-Service"], evidence: ["monitoring","priorAudit"], v4new: true },
      { id: "11.4", covers: "External and internal penetration testing is regularly performed and findings corrected", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["priorAudit"] },
      { id: "11.5", covers: "Network intrusions and unexpected file changes are detected and responded to", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["monitoring","endpoint"] },
      { id: "11.6", covers: "Unauthorized changes on payment pages are detected and responded to", saq: ["A","A-EP","D-Merchant","D-Service"], evidence: ["monitoring"], v4new: true },
    ],
  },
  {
    number: 12,
    objective: "policy",
    name: "Support information security with organizational policies and programs",
    summary: "The program around the technology: policy, risk assessment, training, incident response, and third-party management.",
    nistFunctions: ["Govern","Identify","Respond"],
    note: "v4.0 tightened third-party service provider management (12.8, 12.9) and requires security awareness training at least every 12 months covering phishing and social engineering specifically.",
    subs: [
      { id: "12.1", covers: "A comprehensive information security policy governs and provides direction for protecting account data", saq: ALL, evidence: ["documentedPolicies"] },
      { id: "12.2", covers: "Acceptable use policies for end-user technologies are defined and implemented", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["documentedPolicies"] },
      { id: "12.3", covers: "Risks to the cardholder data environment are formally identified, evaluated, and managed", saq: ["A-EP","D-Merchant","D-Service"], evidence: ["priorAudit"], v4new: true },
      { id: "12.4", covers: "PCI DSS compliance is managed", saq: ["D-Service"], evidence: ["documentedPolicies"] },
      { id: "12.5", covers: "PCI DSS scope is documented and validated", saq: ["D-Merchant","D-Service"], evidence: ["dataInventory"], v4new: true,
        note: "12.5.2 — annual scope confirmation. Applies to SAQ D only, so most self-assessing merchants are not responsible for it." },
      { id: "12.6", covers: "Security awareness education is an ongoing activity", saq: ["A-EP","B","B-IP","C","C-VT","D-Merchant","D-Service"], evidence: ["training"], v4new: true },
      { id: "12.7", covers: "Personnel are screened to reduce risks from insider threats", saq: ["C","D-Merchant","D-Service"], evidence: [] },
      { id: "12.8", covers: "Risk to information assets associated with third-party service provider relationships is managed", saq: ["A","A-EP","B","B-IP","C","C-VT","P2PE","D-Merchant","D-Service"], evidence: ["itManagement"], v4new: true },
      { id: "12.9", covers: "Third-party service providers support their customers' PCI DSS compliance", saq: ["D-Service"], evidence: ["itManagement"], v4new: true },
      { id: "12.10", covers: "Suspected and confirmed security incidents are responded to immediately", saq: ["A-EP","C","D-Merchant","D-Service"], evidence: ["incidentResponse","responseSupport"] },
    ],
  },
];

// ── Deterministic gap analysis with SAQ scoping ───────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function inSaq(sub, saqId) {
  if (sub.saq === ALL) return true;
  return Array.isArray(sub.saq) && sub.saq.includes(saqId);
}

function assessSub(sub, answers) {
  const scores = (sub.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { ...sub, status: STATUS.UNKNOWN, score: null };
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { ...sub, score, status: score >= 80 ? STATUS.MET : score >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

/**
 * @param {object} checklistAnswers
 * @param {object} opts
 * @param {object} opts.paymentProfile  passed to suggestSaq() when saq is absent
 * @param {string} opts.saq             explicit SAQ key (e.g. "A", "D_MERCHANT")
 */
export function assessPciDss(checklistAnswers = {}, { paymentProfile = null, saq = null } = {}) {
  const suggestion = saq
    ? { saq, confident: true, reason: "SAQ specified directly." }
    : suggestSaq(paymentProfile || {});
  const saqKey = suggestion.saq;
  const saqType = PCI_SAQ_TYPES[saqKey];
  const saqId = saqType?.id || "D-Merchant";

  const requirements = PCI_REQUIREMENTS.map(req => {
    const applicable = req.subs.filter(s => inSaq(s, saqId));
    const outOfScope = req.subs.filter(s => !inSaq(s, saqId));
    const subs = applicable.map(s => assessSub(s, checklistAnswers));
    const scored = subs.filter(s => s.status !== STATUS.UNKNOWN);
    const avg = scored.length ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length) : null;

    return {
      number: req.number,
      name: req.name,
      summary: req.summary,
      objective: req.objective,
      nistFunctions: req.nistFunctions,
      note: req.note,
      subs,
      outOfScopeCount: outOfScope.length,
      applicable: applicable.length > 0,
      score: avg,
      status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
    };
  });

  const inScopeSubs = requirements.flatMap(r => r.subs);
  const scored = inScopeSubs.filter(s => s.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(s => s.status === STATUS.GAP);
  const totalSubs = PCI_REQUIREMENTS.flatMap(r => r.subs).length;
  const v4Gaps = gaps.filter(s => s.v4new);

  return {
    framework: PCI_META,
    depth: "control-mapped",
    saq: {
      type: saqId,
      name: saqType?.name || "SAQ D for Merchants",
      forWho: saqType?.forWho,
      criteria: saqType?.criteria || [],
      burden: saqType?.burden,
      note: saqType?.note,
      confident: suggestion.confident,
      reason: suggestion.reason,
    },
    requirements,
    objectives: PCI_OBJECTIVES,
    summary: {
      requirementsTotal: PCI_REQUIREMENTS.length,
      requirementsApplicable: requirements.filter(r => r.applicable).length,
      subRequirementsTotal: totalSubs,
      subRequirementsInScope: inScopeSubs.length,
      // The number that makes PCI tractable for an SMB.
      scopedOut: totalSubs - inScopeSubs.length,
      assessed: scored.length,
      met: scored.filter(s => s.status === STATUS.MET).length,
      partial: scored.filter(s => s.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: inScopeSubs.length - scored.length,
      coveragePct: scored.length
        ? Math.round((scored.filter(s => s.status === STATUS.MET).length / scored.length) * 100)
        : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, covers: g.covers, v4new: !!g.v4new })),
    // v4.0 requirements are the ones most likely to catch a merchant out — they
    // were optional until March 2025 and many businesses haven't caught up.
    v4Gaps: v4Gaps.map(g => ({ id: g.id, covers: g.covers })),
    v4Note: v4Gaps.length
      ? `${v4Gaps.length} of your gaps are v4.0 requirements that became mandatory on 31 March 2025. If you last assessed against v3.2.1, these are new obligations, not best practices.`
      : null,
    scopeAdvice:
      saqId === "D-Merchant"
        ? "You're in the largest scope. Before working through 250 requirements, ask whether you need to be here at all: tokenization, a hosted payment page, or a P2PE terminal can move you to a far smaller SAQ. That's almost always cheaper than compliance."
        : saqId === "A-EP"
        ? "Moving from a Direct Post or JavaScript form to a redirect or iframe integration would put you in SAQ A — the smallest scope there is. It's usually the highest-value PCI decision available to an e-commerce SMB."
        : saqId === "A" || saqId === "P2PE"
        ? "You're in the smallest scope available. Protect that: any change that brings card data back into your systems will expand it sharply."
        : "Reducing what touches cardholder data is the cheapest route to PCI compliance. Ask your acquirer whether a different payment setup would reduce your SAQ.",
    granularityNote:
      "We assess PCI DSS at the sub-requirement level (e.g. 8.3), which is the right granularity for a gap analysis. The standard decomposes further (8.3.1, 8.3.2, …) — around 250 items in total for SAQ D. Your QSA or acquirer works at that level; use this to find and close gaps before you get there.",
    methodology:
      "Requirements are scoped to your SAQ type and assessed from your assessment answers using a fixed mapping — not by an AI's interpretation. Sub-requirements with no corresponding assessment question are reported as 'not yet assessed' rather than assumed compliant.",
    saqCaution:
      "SAQ applicability here reflects the general shape of each questionnaire and is a planning aid. The authoritative source is the SAQ document itself from PCI SSC, and your acquiring bank determines what you must file. Confirm with them before relying on a scope decision.",
    disclaimer:
      "This is a gap analysis, not a Self-Assessment Questionnaire, an Attestation of Compliance, or a Report on Compliance. PCI DSS compliance is validated by completing the SAQ your acquirer requires, or by a Qualified Security Assessor. Use this to prepare.",
  };
}
