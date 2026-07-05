// seedFrameworks.js
// Seeds the compliance frameworks small businesses most commonly face, with
// their REAL controls (accurate identifiers and language, not invented ones).
//
// Idempotent: upsertFramework matches on name, so re-running updates rather than
// duplicates. Run directly:  node seedFrameworks.js
// Or import { seedFrameworks } and call it from server boot if desired.
//
// HONESTY NOTE: these control sets are faithful summaries of each framework's
// requirements, suitable for a small business to self-assess against. They are
// NOT a substitute for the official framework text — for audit/certification,
// clients must reference the authoritative source (linked in each description).
// Where a framework has many sub-requirements, controls are grouped at a
// practical level for SMB self-assessment.

import { db } from "./db.js";
import { upsertFramework } from "./customFrameworks.js";

const FRAMEWORKS = [
  {
    name: "CIS Controls v8.1 (IG1)",
    description: "Center for Internet Security — Implementation Group 1: essential cyber hygiene, the recommended baseline for small businesses. Reference: cisecurity.org/controls.",
    controls: [
      { id: "1.1", title: "Establish and maintain a detailed enterprise asset inventory", category: "Inventory & Control of Enterprise Assets" },
      { id: "1.2", title: "Address unauthorized assets", category: "Inventory & Control of Enterprise Assets" },
      { id: "2.1", title: "Establish and maintain a software inventory", category: "Inventory & Control of Software Assets" },
      { id: "2.2", title: "Ensure authorized software is currently supported", category: "Inventory & Control of Software Assets" },
      { id: "2.3", title: "Address unauthorized software", category: "Inventory & Control of Software Assets" },
      { id: "3.1", title: "Establish and maintain a data management process", category: "Data Protection" },
      { id: "3.2", title: "Establish and maintain a data inventory", category: "Data Protection" },
      { id: "3.3", title: "Configure data access control lists", category: "Data Protection" },
      { id: "3.4", title: "Enforce data retention", category: "Data Protection" },
      { id: "3.5", title: "Securely dispose of data", category: "Data Protection" },
      { id: "3.6", title: "Encrypt data on end-user devices", category: "Data Protection" },
      { id: "4.1", title: "Establish and maintain a secure configuration process", category: "Secure Configuration" },
      { id: "4.2", title: "Establish and maintain a secure configuration process for network infrastructure", category: "Secure Configuration" },
      { id: "4.3", title: "Configure automatic session locking on enterprise assets", category: "Secure Configuration" },
      { id: "4.4", title: "Implement and manage a firewall on servers", category: "Secure Configuration" },
      { id: "4.5", title: "Implement and manage a firewall on end-user devices", category: "Secure Configuration" },
      { id: "4.6", title: "Securely manage enterprise assets and software", category: "Secure Configuration" },
      { id: "4.7", title: "Manage default accounts on enterprise assets and software", category: "Secure Configuration" },
      { id: "5.1", title: "Establish and maintain an inventory of accounts", category: "Account Management" },
      { id: "5.2", title: "Use unique passwords", category: "Account Management" },
      { id: "5.3", title: "Disable dormant accounts", category: "Account Management" },
      { id: "5.4", title: "Restrict administrator privileges to dedicated administrator accounts", category: "Account Management" },
      { id: "6.1", title: "Establish an access granting process", category: "Access Control Management" },
      { id: "6.2", title: "Establish an access revoking process", category: "Access Control Management" },
      { id: "6.3", title: "Require MFA for externally-exposed applications", category: "Access Control Management" },
      { id: "6.4", title: "Require MFA for remote network access", category: "Access Control Management" },
      { id: "6.5", title: "Require MFA for administrative access", category: "Access Control Management" },
      { id: "7.1", title: "Establish and maintain a vulnerability management process", category: "Continuous Vulnerability Management" },
      { id: "7.2", title: "Establish and maintain a remediation process", category: "Continuous Vulnerability Management" },
      { id: "7.3", title: "Perform automated operating system patch management", category: "Continuous Vulnerability Management" },
      { id: "7.4", title: "Perform automated application patch management", category: "Continuous Vulnerability Management" },
      { id: "8.1", title: "Establish and maintain an audit log management process", category: "Audit Log Management" },
      { id: "8.2", title: "Collect audit logs", category: "Audit Log Management" },
      { id: "8.3", title: "Ensure adequate audit log storage", category: "Audit Log Management" },
      { id: "9.1", title: "Ensure use of only fully supported browsers and email clients", category: "Email & Web Browser Protections" },
      { id: "9.2", title: "Use DNS filtering services", category: "Email & Web Browser Protections" },
      { id: "10.1", title: "Deploy and maintain anti-malware software", category: "Malware Defenses" },
      { id: "10.2", title: "Configure automatic anti-malware signature updates", category: "Malware Defenses" },
      { id: "10.3", title: "Disable autorun and autoplay for removable media", category: "Malware Defenses" },
      { id: "11.1", title: "Establish and maintain a data recovery process", category: "Data Recovery" },
      { id: "11.2", title: "Perform automated backups", category: "Data Recovery" },
      { id: "11.3", title: "Protect recovery data", category: "Data Recovery" },
      { id: "11.4", title: "Establish and maintain an isolated instance of recovery data", category: "Data Recovery" },
      { id: "12.1", title: "Ensure network infrastructure is up-to-date", category: "Network Infrastructure Management" },
      { id: "14.1", title: "Establish and maintain a security awareness program", category: "Security Awareness & Skills Training" },
      { id: "14.2", title: "Train workforce to recognize social engineering attacks", category: "Security Awareness & Skills Training" },
      { id: "15.1", title: "Establish and maintain an inventory of service providers", category: "Service Provider Management" },
      { id: "17.1", title: "Designate personnel to manage incident handling", category: "Incident Response Management" },
      { id: "17.2", title: "Establish and maintain contact information for reporting security incidents", category: "Incident Response Management" },
      { id: "17.3", title: "Establish and maintain an enterprise process for reporting incidents", category: "Incident Response Management" },
    ],
  },
  {
    name: "HIPAA Security Rule",
    description: "U.S. HIPAA Security Rule safeguards for protected health information (ePHI), 45 CFR Part 164 Subpart C. Applies to healthcare providers and business associates. Reference: hhs.gov/hipaa.",
    controls: [
      { id: "164.308(a)(1)", title: "Security management process — risk analysis, risk management, sanction policy, information system activity review", category: "Administrative Safeguards" },
      { id: "164.308(a)(2)", title: "Assigned security responsibility (designate a security official)", category: "Administrative Safeguards" },
      { id: "164.308(a)(3)", title: "Workforce security — authorization, clearance, and termination procedures", category: "Administrative Safeguards" },
      { id: "164.308(a)(4)", title: "Information access management — access authorization and establishment/modification", category: "Administrative Safeguards" },
      { id: "164.308(a)(5)", title: "Security awareness and training — reminders, malware protection, log-in monitoring, password management", category: "Administrative Safeguards" },
      { id: "164.308(a)(6)", title: "Security incident procedures — respond to and report incidents", category: "Administrative Safeguards" },
      { id: "164.308(a)(7)", title: "Contingency plan — data backup, disaster recovery, and emergency mode operation", category: "Administrative Safeguards" },
      { id: "164.308(a)(8)", title: "Evaluation — periodic technical and non-technical assessment", category: "Administrative Safeguards" },
      { id: "164.308(b)(1)", title: "Business associate contracts and other arrangements", category: "Administrative Safeguards" },
      { id: "164.310(a)(1)", title: "Facility access controls — limit physical access to systems and facilities", category: "Physical Safeguards" },
      { id: "164.310(b)", title: "Workstation use — policies for proper workstation functions and environment", category: "Physical Safeguards" },
      { id: "164.310(c)", title: "Workstation security — physical safeguards for workstations accessing ePHI", category: "Physical Safeguards" },
      { id: "164.310(d)(1)", title: "Device and media controls — disposal, media re-use, accountability, data backup", category: "Physical Safeguards" },
      { id: "164.312(a)(1)", title: "Access control — unique user ID, emergency access, automatic logoff, encryption/decryption", category: "Technical Safeguards" },
      { id: "164.312(b)", title: "Audit controls — record and examine activity in systems containing ePHI", category: "Technical Safeguards" },
      { id: "164.312(c)(1)", title: "Integrity — protect ePHI from improper alteration or destruction", category: "Technical Safeguards" },
      { id: "164.312(d)", title: "Person or entity authentication — verify identity before access", category: "Technical Safeguards" },
      { id: "164.312(e)(1)", title: "Transmission security — integrity controls and encryption for ePHI in transit", category: "Technical Safeguards" },
      { id: "164.316(a)", title: "Policies and procedures — implement and maintain written security policies", category: "Documentation" },
      { id: "164.316(b)(1)", title: "Documentation — retain, make available, and update security documentation", category: "Documentation" },
    ],
  },
  {
    name: "PCI DSS v4.0",
    description: "Payment Card Industry Data Security Standard — required for any business that stores, processes, or transmits payment card data. Reference: pcisecuritystandards.org.",
    controls: [
      { id: "1", title: "Install and maintain network security controls (firewalls)", category: "Build and Maintain a Secure Network" },
      { id: "2", title: "Apply secure configurations to all system components (no vendor defaults)", category: "Build and Maintain a Secure Network" },
      { id: "3", title: "Protect stored account data (encryption, masking, key management)", category: "Protect Account Data" },
      { id: "4", title: "Protect cardholder data with strong cryptography during transmission over open networks", category: "Protect Account Data" },
      { id: "5", title: "Protect all systems and networks from malicious software", category: "Maintain a Vulnerability Management Program" },
      { id: "6", title: "Develop and maintain secure systems and software (patching, secure development)", category: "Maintain a Vulnerability Management Program" },
      { id: "7", title: "Restrict access to system components and cardholder data by business need-to-know", category: "Implement Strong Access Control" },
      { id: "8", title: "Identify users and authenticate access to system components (unique IDs, MFA)", category: "Implement Strong Access Control" },
      { id: "9", title: "Restrict physical access to cardholder data", category: "Implement Strong Access Control" },
      { id: "10", title: "Log and monitor all access to system components and cardholder data", category: "Regularly Monitor and Test Networks" },
      { id: "11", title: "Test security of systems and networks regularly (scans, penetration tests)", category: "Regularly Monitor and Test Networks" },
      { id: "12", title: "Support information security with organizational policies and programs", category: "Maintain an Information Security Policy" },
    ],
  },
  {
    name: "SOC 2 (Trust Services Criteria)",
    description: "AICPA SOC 2 Common Criteria (Security) — the report B2B customers most often request. Based on the 2017 Trust Services Criteria (with 2022 points of focus). Reference: aicpa.org.",
    controls: [
      { id: "CC1.1", title: "The entity demonstrates a commitment to integrity and ethical values", category: "Control Environment" },
      { id: "CC1.2", title: "The board exercises oversight of internal control", category: "Control Environment" },
      { id: "CC1.3", title: "Management establishes structures, reporting lines, and authorities", category: "Control Environment" },
      { id: "CC1.4", title: "The entity demonstrates a commitment to attract, develop, and retain competent people", category: "Control Environment" },
      { id: "CC1.5", title: "The entity holds individuals accountable for internal control responsibilities", category: "Control Environment" },
      { id: "CC2.1", title: "The entity uses relevant, quality information to support internal control", category: "Communication & Information" },
      { id: "CC2.2", title: "The entity internally communicates information needed for internal control", category: "Communication & Information" },
      { id: "CC2.3", title: "The entity communicates with external parties on matters affecting internal control", category: "Communication & Information" },
      { id: "CC3.1", title: "The entity specifies objectives to enable identification of risks", category: "Risk Assessment" },
      { id: "CC3.2", title: "The entity identifies and analyzes risks to achieving objectives", category: "Risk Assessment" },
      { id: "CC3.3", title: "The entity considers the potential for fraud in assessing risks", category: "Risk Assessment" },
      { id: "CC3.4", title: "The entity identifies and assesses changes that could impact internal control", category: "Risk Assessment" },
      { id: "CC4.1", title: "The entity selects and performs ongoing/separate evaluations of controls", category: "Monitoring Activities" },
      { id: "CC4.2", title: "The entity evaluates and communicates control deficiencies", category: "Monitoring Activities" },
      { id: "CC5.1", title: "The entity selects control activities that mitigate risks", category: "Control Activities" },
      { id: "CC5.2", title: "The entity selects control activities over technology", category: "Control Activities" },
      { id: "CC5.3", title: "The entity deploys control activities through policies and procedures", category: "Control Activities" },
      { id: "CC6.1", title: "Logical access security — restrict access to protect information assets", category: "Logical & Physical Access" },
      { id: "CC6.2", title: "Register and authorize new users before granting access", category: "Logical & Physical Access" },
      { id: "CC6.3", title: "Manage access rights based on roles and least privilege", category: "Logical & Physical Access" },
      { id: "CC6.4", title: "Restrict physical access to facilities and protected assets", category: "Logical & Physical Access" },
      { id: "CC6.5", title: "Securely dispose of protected information and media", category: "Logical & Physical Access" },
      { id: "CC6.6", title: "Implement boundary protections against external threats", category: "Logical & Physical Access" },
      { id: "CC6.7", title: "Restrict the transmission and movement of information; encrypt data", category: "Logical & Physical Access" },
      { id: "CC6.8", title: "Prevent or detect unauthorized or malicious software", category: "Logical & Physical Access" },
      { id: "CC7.1", title: "Use detection tools to identify anomalies and vulnerabilities", category: "System Operations" },
      { id: "CC7.2", title: "Monitor system components for anomalies indicative of security events", category: "System Operations" },
      { id: "CC7.3", title: "Evaluate security events to determine whether they are incidents", category: "System Operations" },
      { id: "CC7.4", title: "Respond to identified security incidents with a defined program", category: "System Operations" },
      { id: "CC7.5", title: "Recover from identified security incidents", category: "System Operations" },
      { id: "CC8.1", title: "Authorize, design, test, and approve changes to infrastructure and software", category: "Change Management" },
      { id: "CC9.1", title: "Identify and mitigate risks from business disruptions", category: "Risk Mitigation" },
      { id: "CC9.2", title: "Assess and manage risks associated with vendors and business partners", category: "Risk Mitigation" },
    ],
  },
  {
    name: "NIST Cybersecurity Framework 2.0",
    description: "NIST CSF 2.0 — a widely adopted, flexible baseline organized around six functions. A strong general-purpose framework for any small business. Reference: nist.gov/cyberframework.",
    controls: [
      { id: "GV.OC", title: "Organizational Context — mission, stakeholders, and requirements are understood", category: "Govern" },
      { id: "GV.RM", title: "Risk Management Strategy — risk priorities and tolerances are established", category: "Govern" },
      { id: "GV.RR", title: "Roles, Responsibilities & Authorities — cybersecurity roles are established", category: "Govern" },
      { id: "GV.PO", title: "Policy — organizational cybersecurity policy is established and communicated", category: "Govern" },
      { id: "GV.OV", title: "Oversight — cybersecurity strategy is reviewed and adjusted", category: "Govern" },
      { id: "GV.SC", title: "Cybersecurity Supply Chain Risk Management", category: "Govern" },
      { id: "ID.AM", title: "Asset Management — assets (data, hardware, software) are inventoried", category: "Identify" },
      { id: "ID.RA", title: "Risk Assessment — cybersecurity risk to the organization is understood", category: "Identify" },
      { id: "ID.IM", title: "Improvement — improvements are identified across the program", category: "Identify" },
      { id: "PR.AA", title: "Identity Management, Authentication & Access Control", category: "Protect" },
      { id: "PR.AT", title: "Awareness & Training — personnel are trained on cybersecurity", category: "Protect" },
      { id: "PR.DS", title: "Data Security — data is managed consistent with the risk strategy", category: "Protect" },
      { id: "PR.PS", title: "Platform Security — hardware/software is managed securely", category: "Protect" },
      { id: "PR.IR", title: "Technology Infrastructure Resilience", category: "Protect" },
      { id: "DE.CM", title: "Continuous Monitoring — assets are monitored to find anomalies and events", category: "Detect" },
      { id: "DE.AE", title: "Adverse Event Analysis — anomalies and events are analyzed", category: "Detect" },
      { id: "RS.MA", title: "Incident Management — responses to incidents are managed", category: "Respond" },
      { id: "RS.AN", title: "Incident Analysis — investigations are conducted", category: "Respond" },
      { id: "RS.CO", title: "Incident Response Reporting & Communication", category: "Respond" },
      { id: "RS.MI", title: "Incident Mitigation — activities to contain and eradicate incidents", category: "Respond" },
      { id: "RC.RP", title: "Incident Recovery Plan Execution", category: "Recover" },
      { id: "RC.CO", title: "Incident Recovery Communication", category: "Recover" },
    ],
  },
  {
    name: "FTC Safeguards Rule",
    description: "FTC Standards for Safeguarding Customer Information (16 CFR Part 314) — applies to non-bank financial institutions, including many small businesses (auto dealers, tax preparers, mortgage brokers, etc.). Reference: ftc.gov.",
    controls: [
      { id: "314.4(a)", title: "Designate a qualified individual to oversee the information security program", category: "Program Governance" },
      { id: "314.4(b)", title: "Conduct a written risk assessment of foreseeable risks to customer information", category: "Risk Assessment" },
      { id: "314.4(c)(1)", title: "Implement access controls, including authentication and least privilege", category: "Safeguards" },
      { id: "314.4(c)(2)", title: "Identify and manage data, personnel, devices, and systems (inventory)", category: "Safeguards" },
      { id: "314.4(c)(3)", title: "Encrypt customer information at rest and in transit", category: "Safeguards" },
      { id: "314.4(c)(4)", title: "Adopt secure development practices for in-house applications", category: "Safeguards" },
      { id: "314.4(c)(5)", title: "Implement multi-factor authentication for anyone accessing customer information", category: "Safeguards" },
      { id: "314.4(c)(6)", title: "Securely dispose of customer information no longer needed", category: "Safeguards" },
      { id: "314.4(c)(7)", title: "Adopt procedures for change management", category: "Safeguards" },
      { id: "314.4(c)(8)", title: "Monitor and log activity of authorized users; detect unauthorized access", category: "Safeguards" },
      { id: "314.4(d)", title: "Regularly test or monitor the effectiveness of safeguards (or continuous monitoring)", category: "Testing" },
      { id: "314.4(e)", title: "Train staff and provide security personnel with updates on relevant risks", category: "Training" },
      { id: "314.4(f)", title: "Oversee service providers and require them to maintain safeguards", category: "Service Providers" },
      { id: "314.4(g)", title: "Keep the information security program current as circumstances change", category: "Program Maintenance" },
      { id: "314.4(h)", title: "Establish a written incident response plan", category: "Incident Response" },
      { id: "314.4(i)", title: "Require the qualified individual to report in writing to leadership at least annually", category: "Reporting" },
    ],
  },
];

export async function seedFrameworks() {
  await db.read();
  db.data.customFrameworks ||= [];
  let created = 0, updated = 0;
  for (const fw of FRAMEWORKS) {
    const existed = (db.data.customFrameworks || []).some(
      f => f.name.trim().toLowerCase() === fw.name.trim().toLowerCase()
    );
    await upsertFramework(db, fw, "seed");
    if (existed) updated++; else created++;
    console.log(`  ${existed ? "updated" : "created"}: ${fw.name} (${fw.controls.length} controls)`);
  }
  console.log(`\n✅ Frameworks seeded — ${created} created, ${updated} updated, ${FRAMEWORKS.length} total.`);
  return { created, updated, total: FRAMEWORKS.length };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  seedFrameworks()
    .then(() => process.exit(0))
    .catch(err => { console.error("Framework seed failed:", err); process.exit(1); });
}
