// policyCatalog.js
// Catalog of available security policies users can generate.
// Each entry defines the policy metadata and the specific
// questions needed to customize it for the requesting business.

export const POLICY_CATALOG = [
  {
    id: "acceptable-use",
    name: "Acceptable Use Policy",
    category: "General",
    description: "Defines acceptable and prohibited use of company devices, networks, and accounts.",
    fields: [
      { id: "allowedDevices", label: "What devices may employees use for work? (e.g., company laptops only, or BYOD allowed)", type: "text" },
      { id: "personalUse", label: "Is limited personal use of company devices/internet allowed?", type: "select", options: ["Not allowed", "Allowed during breaks only", "Allowed reasonably at any time"] },
      { id: "socialMedia", label: "Any restrictions on social media use during work hours?", type: "text" },
    ],
  },
  {
    id: "password-policy",
    name: "Password & Authentication Policy",
    category: "Identity",
    description: "Sets requirements for password strength, rotation, and multi-factor authentication.",
    fields: [
      { id: "minLength", label: "Minimum password length?", type: "select", options: ["8 characters", "12 characters", "14+ characters"] },
      { id: "mfaRequired", label: "Is multi-factor authentication (MFA) required?", type: "select", options: ["Required for all accounts", "Required for admin/privileged accounts only", "Not currently required"] },
      { id: "rotationPolicy", label: "Password rotation requirement?", type: "select", options: ["Every 90 days", "Every 180 days", "No forced rotation (NIST modern guidance)"] },
    ],
  },
  {
    id: "data-classification",
    name: "Data Classification Policy",
    category: "Data",
    description: "Establishes categories for data sensitivity and handling requirements for each.",
    fields: [
      { id: "dataTypes", label: "What types of sensitive data does your business handle? (e.g., customer PII, payment cards, health records)", type: "text" },
      { id: "storageLocations", label: "Where is sensitive data primarily stored? (e.g., cloud drive, on-prem server, SaaS apps)", type: "text" },
    ],
  },
  {
    id: "incident-response",
    name: "Incident Response Policy",
    category: "Operations",
    description: "Defines how the organization detects, responds to, and recovers from security incidents.",
    fields: [
      { id: "incidentContact", label: "Who is the primary contact/owner for security incidents? (role/title)", type: "text" },
      { id: "notificationRequirements", label: "Any regulatory breach notification requirements? (e.g., HIPAA 60-day rule, state law)", type: "text" },
      { id: "externalSupport", label: "Do you have access to external IT/security support for incidents?", type: "select", options: ["Yes, retained MSP/security firm", "No, handled internally only", "Not sure"] },
    ],
  },
  {
    id: "remote-work",
    name: "Remote Work & BYOD Policy",
    category: "Operations",
    description: "Covers security requirements for employees working remotely or using personal devices.",
    fields: [
      { id: "remoteFrequency", label: "How much of your workforce works remotely?", type: "select", options: ["Fully remote", "Hybrid", "Occasional/rare remote work", "Fully in-office"] },
      { id: "vpnRequired", label: "Is a VPN required for remote access to company systems?", type: "select", options: ["Yes, required", "No", "Not currently, but considering"] },
      { id: "personalDevices", label: "Can employees access company data on personal devices?", type: "select", options: ["Yes, unrestricted", "Yes, with MDM/security controls", "No"] },
    ],
  },
  {
    id: "vendor-risk",
    name: "Vendor & Third-Party Risk Policy",
    category: "Operations",
    description: "Establishes requirements for evaluating and managing security risk from vendors and partners.",
    fields: [
      { id: "criticalVendors", label: "List your most critical vendors/service providers (e.g., cloud hosting, payroll, IT support)", type: "text" },
      { id: "dataSharedWithVendors", label: "Do any vendors have access to your sensitive data or systems?", type: "select", options: ["Yes, several do", "Yes, one or two do", "No / not sure"] },
    ],
  },
  {
    id: "data-retention",
    name: "Data Retention & Disposal Policy",
    category: "Data",
    description: "Specifies how long different types of data are retained and how it's securely disposed of.",
    fields: [
      { id: "retentionDriver", label: "What's the main driver for your retention requirements? (e.g., tax law, HIPAA, contracts, no specific requirement)", type: "text" },
      { id: "disposalMethod", label: "How is old data/equipment currently disposed of?", type: "select", options: ["Professional shredding/wiping service", "Done internally (delete/format)", "No formal process"] },
    ],
  },
  {
    id: "access-control",
    name: "Access Control Policy",
    category: "Identity",
    description: "Defines how user access to systems and data is granted, reviewed, and revoked.",
    fields: [
      { id: "accessModel", label: "How is access typically granted today?", type: "select", options: ["Role-based (by job function)", "Ad-hoc / case-by-case", "Everyone has broad access"] },
      { id: "offboardingProcess", label: "Is there a formal process to revoke access when someone leaves?", type: "select", options: ["Yes, documented process", "Informal/inconsistent", "No process"] },
    ],
  },
  {
    id: "email-security",
    name: "Email & Communication Security Policy",
    category: "Network",
    description: "Covers safe email practices, phishing awareness, and secure communication requirements.",
    fields: [
      { id: "emailProvider", label: "What email platform do you use? (e.g., Microsoft 365, Google Workspace)", type: "text" },
      { id: "sensitiveDataInEmail", label: "Is sensitive data (e.g., SSNs, payment info) ever sent via email?", type: "select", options: ["Yes, regularly", "Occasionally", "No / prohibited"] },
    ],
  },
  {
    id: "backup-recovery",
    name: "Backup & Disaster Recovery Policy",
    category: "Operations",
    description: "Defines backup frequency, retention, and recovery procedures for critical systems and data.",
    fields: [
      { id: "currentBackups", label: "What's your current backup setup? (e.g., cloud auto-backup, none, manual)", type: "text" },
      { id: "rto", label: "How quickly would you need to be back up and running after a major outage?", type: "select", options: ["Within hours", "Within 1-2 days", "Within a week", "Not sure"] },
    ],
  },
  {
    id: "physical-security",
    name: "Physical Security Policy",
    category: "General",
    description: "Covers security of physical office space, equipment, and access to facilities.",
    fields: [
      { id: "officeType", label: "What best describes your workspace?", type: "select", options: ["Dedicated office/building", "Shared coworking space", "Fully remote / no physical office"] },
      { id: "physicalAccess", label: "How is physical access to your workspace controlled?", type: "text" },
    ],
  },
  {
    id: "change-management",
    name: "Change Management Policy",
    category: "Operations",
    description: "Establishes a process for making and approving changes to IT systems and infrastructure.",
    fields: [
      { id: "itManagement", label: "Who manages your IT systems/infrastructure?", type: "select", options: ["In-house IT staff", "Outsourced MSP", "No dedicated management"] },
      { id: "changeFrequency", label: "How often do you make significant changes to systems/software?", type: "select", options: ["Frequently (weekly/monthly)", "Occasionally (quarterly)", "Rarely"] },
    ],
  },
];
