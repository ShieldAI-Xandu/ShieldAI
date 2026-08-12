// helpManual.js
// The ShieldAI client user manual — single source of truth for two consumers:
//   1. The in-app Help Center (src/App.jsx, HelpCenterScreen) renders HELP_MANUAL.
//   2. Mastermind's client chat system prompt (mastermindRoutes.js) includes
//      manualAsText() so it can answer "how do I..." questions grounded in the
//      real product rather than guessing.
// Keep this file free of JSX/React so both a Vite frontend and a plain Node
// backend can import it directly.
//
// Content reflects ACTUAL current behavior, not aspirational tier gates in
// tiers.js's FEATURE_CATALOG, where the two disagree (see inline notes on the
// Threat Intel and Analyst Chat sections) — this file describes what a client
// can really do today.

export const HELP_MANUAL = [
  {
    id: "getting-started",
    title: "Your Security Assessment & Posture Score",
    icon: "🚀",
    tier: "Every plan, including Free",
    articles: [
      {
        id: "run-assessment",
        title: "Run your security assessment",
        intro: "The assessment is how ShieldAI learns about your business so everything else — your score, policies, compliance tracking — is tailored to you instead of generic.",
        steps: [
          "From Home, click \"New Assessment.\" A conversational AI chat asks about your industry, employee count, the kinds of data you handle, your current tools/IT staff, compliance needs, and any past incidents — usually 7-9 questions.",
          "Next, choose your posture \"lens\": NIST Cybersecurity Framework, CIS Controls v8.1, or both. This only changes how your score is grouped and labeled, not the questions you'll answer.",
          "Answer the full checklist: 13 required questions that drive your score, plus optional questions that unlock more compliance controls for tracking. This is also where you pick which compliance frameworks to track (SOC 2, HIPAA, PCI DSS, ISO 27001, and others).",
          "Submit to see your posture score immediately — this step is free on every plan, no card required.",
        ],
        notes: ["You can return to Home and click \"Edit Assessment\" any time your business changes — new tools, new headcount, a new compliance requirement."],
      },
      {
        id: "understand-score",
        title: "Understand your posture score",
        intro: "Your score is a 0-100 number computed by a deterministic scoring engine against your chosen framework — never an AI guess.",
        steps: [
          "Open the score breakdown to see each NIST function (Identify, Protect, Detect, Respond, Recover) — or CIS hygiene area — scored separately.",
          "The two lowest-scoring areas are flagged as \"priority areas\" so you know what to fix first.",
          "If you chose \"Both\" frameworks at intake, an expandable section shows the alternate lens's view of the same answers.",
          "Every point on the score traces back to a specific answer you gave — there's no black box.",
        ],
      },
    ],
  },

  {
    id: "security-program",
    title: "Your Security Program",
    icon: "📋",
    tier: "Starter and above",
    articles: [
      {
        id: "program-sections",
        title: "What generating your program produces",
        intro: "After the checklist, paid plans automatically generate a complete program from your answers: a prioritized roadmap, draft policies, a compliance gap analysis, incident-response playbooks, a recommended tool stack, a training preview, and an executive report.",
        steps: [
          "Priorities: your top 5 roadmap items plus 3 quick wins you can knock out immediately.",
          "Policies (preview): draft policy language across six core areas. These are previews — the actual saved, downloadable, and assignable versions live in the Policy Library (see that section below).",
          "Workflows (Growth and above): three incident-response playbooks — ransomware, phishing, and data breach.",
          "Tools: six tool-stack categories describing what capability to look for, not specific brand pitches.",
          "Executive Report: a leadership-ready summary — headline, business risk, investment/ROI framing, key findings, and next steps. Good to hand to ownership or a board.",
        ],
        notes: ["Each section shows a small badge naming which AI model actually generated it — this isn't cosmetic, different sections are intentionally routed to different providers for their strengths."],
      },
    ],
  },

  {
    id: "policies",
    title: "Policy Library & Employee Sign-Off",
    icon: "📄",
    tier: "Starter and above (download-as-Word requires Growth+; roster capped at 10 employees on Starter, unlimited on Growth+)",
    articles: [
      {
        id: "generate-policy",
        title: "Generate and save a policy",
        intro: "The Policy Library is where you get real, usable policy documents — separate from the read-only previews in Your Security Program.",
        steps: [
          "Open Policy Library, pick a policy type from the catalog, and answer a few company-specific questions.",
          "ShieldAI drafts the policy. Review it, then it's automatically saved to \"My Policies.\"",
          "Download it as a Word document (Growth and above) to edit further or file for an auditor.",
        ],
      },
      {
        id: "roster-acknowledgment",
        title: "Get employees to acknowledge a policy",
        intro: "Every saved policy can be assigned to your team for a real, tracked acknowledgment — no accounts or passwords required on their end.",
        steps: [
          "Add your team to the employee roster once (name, email, department). This same roster is shared with the Training feature, so you only enter people once.",
          "On any saved policy, click \"Assign\" and check off who needs to acknowledge it.",
          "Each person gets a personal link. They read the policy, check \"I have read this policy and agree to comply with it,\" and confirm.",
          "The policy card shows a running \"X of Y acknowledged\" count. Use \"Remind\" to nudge anyone still pending, or \"Remove\" to unassign someone.",
        ],
        notes: ["This acknowledgment record is a real audit trail — it's exactly what an auditor or cyber-insurance underwriter will ask to see."],
      },
    ],
  },

  {
    id: "endpoints",
    title: "Endpoint Monitoring",
    icon: "🖥️",
    tier: "Starter and above (5 endpoints on Starter, 25 on Growth, 100 on Guided, unlimited on Managed)",
    articles: [
      {
        id: "install-agent",
        title: "Install the monitoring agent on a computer",
        intro: "The agent gives you real, measured visibility into a computer or server's security posture — not just your own self-reported answers.",
        steps: [
          "Click the \"🖥️ Endpoints\" button in the top bar, then \"Add Endpoint.\"",
          "Pick the operating system (Windows, macOS, or Linux). ShieldAI mints a one-time enrollment token (valid 60 minutes) and downloads one installer file with the server address and token already built in.",
          "Windows: run `powershell -ExecutionPolicy Bypass -File .\\ShieldAI-Install.ps1` as Administrator. macOS/Linux: run `sudo bash ShieldAI-Install-<os>.sh`.",
          "Within a few minutes the endpoint appears in your fleet list with an Online/Offline status and a posture summary.",
        ],
        notes: ["The agent is strictly read-only: it reports what it observes (antivirus status, disk encryption, patch level, and similar) and uploads that report. It cannot receive commands and never changes anything on the machine — there is no channel for that, by design."],
      },
      {
        id: "endpoint-detail",
        title: "Review what the agent found",
        intro: "Click into any endpoint in your fleet list for its full detail.",
        steps: [
          "Security Events: a feed of anything notable the agent observed, tagged by severity.",
          "Posture Checks: a pass/fail/warn list per control, with the specific CIS control it maps to where applicable.",
          "Inventory: disk encryption, firewall status, pending patches, installed security tools, and local-admin account count.",
          "\"Request check-in\" flags the agent to send a fresh report on its next scheduled poll, instead of waiting for its normal cadence (about every 60 minutes by default) — useful right after you've made a change and want ShieldAI to see it sooner. The button shows \"Check-in requested\" until that next report arrives.",
          "\"Remove endpoint\" deletes the agent and its history if you retire a machine.",
        ],
        notes: [
          "If what the agent measures disagrees with an answer you gave on your assessment, ShieldAI flags it as a discrepancy for you to resolve in the Compliance tab's Conflict Queue — it never silently overrides your answer.",
          "\"Request check-in\" doesn't reach out to the machine — the agent is strictly read-only and only ever contacts ShieldAI on its own schedule, never the other way around. This just flags that the next time it does, it should send a full report right away instead of waiting for anything else. It's usually a few minutes to under an hour, not instant.",
        ],
      },
    ],
  },

  {
    id: "integrations",
    title: "Security Tool, Directory & Productivity Integrations",
    icon: "🔌",
    tier: "Growth and above (3 connections on Growth, 10 on Guided, unlimited on Managed)",
    articles: [
      {
        id: "connect-webhook-tool",
        title: "Connect a scanner, EDR, or SIEM",
        intro: "Feed real findings from your existing security tools into ShieldAI instead of re-entering them by hand. ShieldAI only receives what your tool sends — it never connects out to your tool or changes anything there.",
        steps: [
          "Click \"🔌 Integrations\" in the top bar, then \"+ Add Integration.\"",
          "Name the connection and pick your tool: Nessus/Tenable, Qualys, Rapid7 InsightVM, Microsoft Defender, CrowdStrike, Wazuh, Splunk, or Generic/Custom for anything else.",
          "ShieldAI shows a webhook URL and a bearer token — shown once, so copy both now. Point your tool's outbound webhook, forwarding script, or SOAR workflow at that URL with the token as a Bearer Authorization header.",
          "Findings appear on the connection's detail page as they come in. Anything medium severity or above is automatically drafted into a recommendation for your analyst to review before it ever reaches you.",
        ],
        notes: [
          "Most of these tools don't push data on their own — Nessus, Qualys, Rapid7, Defender, and Falcon Spotlight need a small script or a SOAR/iPaaS workflow (Zapier, Tines, a scheduled job) polling the tool and forwarding results. CrowdStrike Falcon Fusion SOAR and Wazuh's Integrator module can point straight at the webhook URL with no script. The Add Integration screen shows setup guidance specific to whichever tool you pick.",
          "Acknowledging a finding is triage only — it never changes anything back on the source tool.",
        ],
      },
      {
        id: "connect-directory",
        title: "Connect Microsoft 365, Google Workspace, Okta, or Zoom",
        intro: "Directory connections pull security-posture facts you'd otherwise have to check manually — MFA coverage, privileged/admin accounts, stale accounts, meeting security settings, and policy gaps — straight from the tools you already run. Read-only, always: ShieldAI can see this data but can never change anything in your account.",
        steps: [
          "Click \"🔌 Integrations\" in the top bar, then \"+ Connect Directory.\"",
          "Pick your provider. Microsoft 365, Google Workspace, and Zoom use a normal sign-in-and-approve screen — you'll need admin access in that account for the consent screen to succeed. Okta instead asks for your Okta domain and a read-only API token, which your Okta admin generates from Security → API → Tokens in the Okta console.",
          "Once connected, open the connection and click \"Sync now\" to pull the latest posture data. Syncing isn't automatic yet — run it again any time you want a fresh check.",
          "Findings like \"no MFA on 3 admin accounts,\" \"no Conditional Access policies enabled,\" or \"meeting passcodes not required\" appear on the connection page, and medium-or-above findings are drafted into a recommendation the same way webhook findings are.",
        ],
        notes: [
          "This never changes your posture score directly — your score stays based on your assessment answers. Directory findings show up as recommendations so you or your analyst can act on them, not as a silent second score.",
          "If a connection shows \"Needs reconnect,\" access has expired or was revoked on the provider's side (for example, an admin removed consent) — reconnect it the same way you connected it the first time.",
        ],
      },
      {
        id: "connect-slack",
        title: "Get Slack or Microsoft Teams notifications",
        intro: "Connect Slack or Teams to get pinged in a channel of your choosing whenever there's new security work — a recommendation is ready, a task is completed, a phishing simulation goes out, or a policy needs sign-off. ShieldAI only ever posts messages; it never reads your channel history or anything else in your workspace.",
        steps: [
          "Click \"🔌 Integrations\" in the top bar, then \"+ Connect Chat Tool,\" and pick Slack or Microsoft Teams.",
          "Slack: you'll be sent to Slack to approve ShieldAI posting to your workspace, then land back here automatically. Open the connection and click \"Choose a channel\" to pick where ShieldAI should post — only channels the ShieldAI Slack app has been invited to will show up, so invite it to a channel first if you don't see the one you want.",
          "Teams: in the channel you want alerts in, add a webhook (⋯ → Workflows → \"Post to a channel when a webhook request is received,\" or on older setups Connectors → Incoming Webhook), copy the URL it gives you, and paste it into ShieldAI. The channel is already fixed by that URL, so there's no separate channel picker.",
          "Turn on the specific events you want to hear about under \"Notify on.\" Slack needs a channel picked first — Teams doesn't, since the webhook URL already points at one.",
        ],
        notes: [
          "A new recommendation posted to Slack comes with action buttons — \"I'll handle it,\" \"Mark done,\" or \"Decline\" — so you can respond right from Slack instead of opening ShieldAI. In Teams, those same buttons open your browser to apply the action instead, since a bare Teams webhook can't receive button clicks the way Slack can — you'll land back in ShieldAI already signed in, and it applies immediately. Other notifications (task completed, phishing sent, policy assigned) are informational only, with no buttons, on either platform.",
          "If several recommendations get drafted at once, notifications still only go out at the moment each one is actually proposed to you by your analyst — nothing reaches Slack or Teams before a human has reviewed it, same as everywhere else in ShieldAI.",
        ],
      },
      {
        id: "connect-task-tracker",
        title: "Sync remediation tasks to Jira, Asana, or Trello",
        intro: "Turn a ShieldAI remediation task into a real ticket in the tracker your team already works from, and check its status without leaving ShieldAI.",
        steps: [
          "Click \"🔌 Integrations\" in the top bar, then \"+ Connect Task Tracker,\" and pick Jira, Asana, or Trello.",
          "Jira and Asana send you to sign in and approve; Trello asks you to paste an API key and token from your Trello account instead (trello.com/power-ups/admin) — no sign-in redirect for Trello.",
          "Finish setup by picking where new tickets go: a Jira project, an Asana workspace and project, or — for Trello, which has no built-in status field — a board plus which list counts as \"default\" and which counts as \"done.\"",
          "On any remediation task, click \"Sync to [tracker]\" to create the ticket, or \"Sync status\" once it's already synced to pull its current state back.",
        ],
        notes: [
          "Syncing a task only ever creates that one ticket — ShieldAI never reads or changes anything else in your tracker. Status is pulled on demand, not automatically, so click \"Sync status\" for a fresh check.",
          "Pulling a tracker's status never marks the ShieldAI task complete by itself — you still click \"Complete & Re-score\" in ShieldAI to actually finish it and update your posture score. The tracker's status shows alongside the task as information, not a substitute for that.",
        ],
      },
      {
        id: "schedule-a-call",
        title: "Schedule a call with Zoom or Google Meet",
        intro: "Create a meeting link for an advisor check-in or an incident call, right from the Support Center.",
        steps: [
          "Open the Support Center and find \"Schedule a call.\"",
          "The first time, connect Zoom or Google Meet — a normal sign-in-and-approve screen for your own personal account, separate from any directory connection you may have set up.",
          "Pick a topic, date/time, and duration, then click \"Schedule.\" ShieldAI creates the meeting and shows you the join link immediately.",
        ],
        notes: ["This is the one place ShieldAI ever creates something in a connected account rather than just reading from it — and it only ever creates the exact meeting you asked for, nothing else. No calendar access, no recurring connection beyond that one request."],
      },
    ],
  },

  {
    id: "recommendations-tasks",
    title: "Recommendations & Remediation Tasks",
    icon: "✅",
    tier: "Recommendations: available whenever you have a monitored endpoint. Remediation/Tasks tab: Growth and above.",
    articles: [
      {
        id: "recommendations",
        title: "Act on a recommendation",
        intro: "A recommendation is advice, often drafted from something your monitoring agent found, then reviewed by an analyst before it ever reaches you. It shows up at the top of the Endpoints screen.",
        steps: [
          "Read the recommendation and choose one of three options: \"I'll handle it\" (you'll fix it yourself), \"Permit analyst to perform\" (let your analyst make the change with your permission), or \"Decline.\"",
          "If you chose to handle it yourself, click \"Mark done\" once it's complete.",
        ],
      },
      {
        id: "tasks",
        title: "Work through prioritized remediation tasks",
        intro: "The Remediation tab turns unmet controls into trackable work, ranked by how much they'd actually improve your score.",
        steps: [
          "Open the \"Prioritized Gaps\" tab to see every unmet or partial control ranked by projected posture-score gain.",
          "Click \"Create Task\" on a gap to turn it into tracked work tied to that specific control.",
          "Move a task through Start → (optionally Block) → \"Complete & Re-score.\"",
          "Completing a task re-answers that control on your assessment, recomputes your score immediately, and records the exact point gain — which also feeds your posture trend chart over time.",
        ],
      },
    ],
  },

  {
    id: "compliance",
    title: "Compliance Tracking & Compliance Calendar",
    icon: "🛡️",
    tier: "Starter and above (2 additional frameworks on Starter beyond your NIST/CIS foundation, 5 on Growth, 10 on Guided, unlimited on Managed)",
    articles: [
      {
        id: "compliance-overview",
        title: "Track a compliance framework",
        intro: "You choose which frameworks to track at intake. The Compliance tab shows real, ongoing status for each.",
        steps: [
          "Each framework shows as a card with a readiness percentage and met/partial/gap/not-assessed counts.",
          "A badge on each card is honest about depth: \"Control-mapped\" means every real, cited control is assessed deterministically (e.g. all 93 ISO 27001 Annex A controls); \"AI-assisted\" means a contextual gap analysis rather than control-by-control; \"Planned\" means it's not built out yet.",
          "Click into a framework for a control-by-control walkthrough, filterable by status. Some frameworks (like SOC 2) have their own short scoping questionnaire — expand \"Update scoping\" at the top of the walkthrough any time your answers there change (report type, in-scope systems, and similar); it isn't a one-time form.",
        ],
      },
      {
        id: "fix-a-control-answer",
        title: "Correct a specific control's answer",
        intro: "Got a control wrong, or something changed? Fix it right from the walkthrough instead of redoing your whole assessment.",
        steps: [
          "In a framework's control-by-control walkthrough, click a control to expand it, then click \"Update answer.\"",
          "Pick the new answer from the list shown — it's scored and saved immediately, and your posture score and every framework's readiness recompute right away.",
        ],
        notes: [
          "If a control shows a CONFLICT badge (your answer disagrees with what the monitoring agent measured), this inline editor is hidden — resolve it in the Conflict Queue instead, so the disagreement gets recorded properly rather than one side silently overwriting the other.",
          "This only touches the one control you're editing. To change company-wide details (industry, employee count, which frameworks you're tracking), use \"Edit Assessment\" from Home instead.",
        ],
      },
      {
        id: "conflict-queue",
        title: "Resolve a conflict between your answers and agent telemetry",
        intro: "When your monitoring agent measures something that disagrees with what you answered on your assessment, it shows up in the Conflict Queue rather than silently changing either one.",
        steps: [
          "Open the Conflict Queue to see the disputed control with both values side by side.",
          "Under \"The agent is right — update my answer,\" click Yes or No. Yes applies the agent's finding — instantly if there's only one answer that matches it, or narrowed to just the matching answers if more than one could fit, so you're never guessing. No opens the full list of answers instead, if what actually happened isn't well described by the agent's finding.",
          "Or choose one of the other two options: keep your answer and open a fix-it task for the failing hosts, or mark the affected hosts \"not representative\" (a reason is required).",
        ],
      },
      {
        id: "calendar",
        title: "Use the Compliance Calendar",
        intro: "The Calendar tab pulls together everything with a real due date so you check one place instead of hunting across tabs.",
        steps: [
          "It automatically aggregates: vendor reassessment due-dates, pending policy sign-offs, scheduled training due-dates, and any custom reminders you add yourself (insurance renewal, license expiration, audit date, and similar — one-time or recurring).",
          "Overdue and due-soon items are called out. Click \"Mark done\" on a recurring item to roll its due date forward automatically.",
        ],
      },
    ],
  },

  {
    id: "threat-intel",
    title: "Threat Intelligence: CVEs, Dark Web & Email Security",
    icon: "🔍",
    tier: "Domain registration/verification and email security: every plan. Real CVE exposure and dark-web/breach data: Growth and above.",
    articles: [
      {
        id: "cve-exposure",
        title: "Check your CVE exposure",
        intro: "Click \"🔍 Threat Intel\" in the top bar. The CVE Exposure card matches your monitored software against the live NIST National Vulnerability Database.",
        steps: [
          "Review the severity rollup and the top CVEs, each with its real CVSS score and a link you can check directly at nvd.nist.gov.",
          "Click \"Refresh\" to re-check after installing new software or enrolling a new endpoint.",
        ],
        notes: [
          "Matches depend on your monitored software (from an agent or your assessment) — the more of your stack ShieldAI can see, the more complete this is.",
          "This is a Growth-plan feature. On Starter and Free, the card shows an upgrade prompt instead of live data.",
        ],
      },
      {
        id: "domain-monitoring",
        title: "Set up dark-web/breach monitoring for your domain",
        intro: "This checks Have I Been Pwned for your company's exposed credentials — but it requires proving you own the domain first.",
        steps: [
          "In the Threat Intel screen's domain card, add your company domain (you can register more than one, useful for multiple brands or regional sites). Domain registration and DNS verification are available on every plan, including Free.",
          "Publish the DNS TXT record shown for your domain, then click \"Check DNS record\" to verify.",
          "After DNS verification, the domain shows \"Monitoring setup in progress\" while ShieldAI staff completes enrollment with the breach-monitoring source — this is not instant. Once that's done, status changes to fully monitored and shows breach status level, breached-account count, and named breaches. Viewing the actual breach results is a Growth-plan feature — Starter and Free can still register and verify a domain so results are ready the moment they upgrade.",
        ],
        notes: ["Any demo or simulated breach data is always clearly labeled \"SIMULATED — DEMO ONLY.\" A \"Not monitored\" or \"Not checked\" status is a coverage gap, not a clean bill of health."],
      },
      {
        id: "email-security",
        title: "Check your email security posture",
        intro: "The Email Security card runs a plain public DNS lookup for SPF, DKIM, and DMARC on your domain — no ownership verification needed, since it's public information. Available on every plan.",
        steps: ["Open the Threat Intel screen to see your current SPF/DKIM/DMARC status for each registered domain."],
      },
    ],
  },

  {
    id: "vendor-risk",
    title: "Vendor Risk Registry",
    icon: "🤝",
    tier: "Registry: Starter and above (5 vendors on Starter, unlimited on Growth+). AI questionnaire assistant: Growth and above.",
    articles: [
      {
        id: "add-vendor",
        title: "Add and track a vendor",
        intro: "Track every vendor or service provider that touches your business or your data — payment processors, your MSP, cloud hosting, payroll, and similar.",
        steps: [
          "In Vendor Risk, click \"+ Add vendor\" and fill in name, category, criticality (critical/high/medium/low), data access level, contact details, contract start date, whether they have a current security certification on file, and whether a DPA/BAA is in place.",
          "ShieldAI automatically sets a reassessment due date based on criticality: critical vendors every 6 months, high/medium every 12 months, low every 24 months. You can override the cadence per vendor.",
          "The vendor table's Review Status column shows Overdue, Due soon, Current, or Not scheduled, color-coded. Click \"Reassess\" (with an optional note) to reset the clock once you've reviewed a vendor.",
        ],
      },
      {
        id: "questionnaire-assistant",
        title: "Draft responses to an incoming security questionnaire",
        intro: "When one of your own customers sends you a security questionnaire to fill out, this tool drafts grounded answers instead of you starting from a blank page.",
        steps: [
          "At the bottom of Vendor Risk, paste the text of the questionnaire your customer sent you.",
          "Click \"Draft responses.\" Every answer is grounded in your own real program data — your actual generated policies, your actual computed posture score, your actual vendor count.",
          "Anything ShieldAI can't verify from your real data is flagged \"Needs your input\" rather than guessed — fill those in yourself before sending the response back.",
          "Past drafts are saved under \"View past responses\" and can be deleted once no longer needed.",
        ],
      },
    ],
  },

  {
    id: "training",
    title: "Security Training & Phishing Simulation",
    icon: "🎓",
    tier: "Training preview: Starter+. Full training delivery and phishing campaigns: Growth+ (or Starter plus the $40/mo Training Delivery add-on). A one-time free phishing test is available on Starter without the add-on.",
    articles: [
      {
        id: "training-preview",
        title: "View your training preview",
        intro: "The Training tab shows a 2-module curriculum preview generated as part of your security program.",
        steps: ["Open the Training tab to preview the modules. This is view-only until you generate the full program."],
      },
      {
        id: "full-training-program",
        title: "Assign and run full training for your team",
        intro: "The Training Program tab is where you actually assign coursework and track completion.",
        steps: [
          "Generate the full curriculum: 12 core modules over 3 months, plus a quarterly refresher and an optional manager track.",
          "Add employees to your roster (shared with the Policy Library — enter someone once, use them in both places).",
          "Under \"Assign,\" pick learners and topics and set a due date. Under \"Quarterly,\" schedule a topic for every active learner at once.",
          "Each learner gets a personal `/train/:token` link (no login required) with slides and a scored quiz for each module.",
          "Track completion, overdue learners, and average scores under Overview, and export a CSV from Reports.",
        ],
      },
      {
        id: "phishing-sim",
        title: "Run a phishing simulation",
        intro: "Test whether your team recognizes a phishing attempt with a real, safe simulated email — never a fake credential-harvesting page.",
        steps: [
          "In the Phishing Sim sub-tab, pick a scenario and choose which learners to target.",
          "Click \"Create Draft\" to review it, then \"Send Now\" to actually send the simulated emails (a confirmation prompt appears since these are real messages).",
          "Watch the click-rate percentage roll in, and open \"Details\" for a per-person breakdown (Sent/Clicked/Pending/Send failed).",
          "Anyone who clicks lands on an educational page showing exactly which red flags in that scenario should have tipped them off — a teaching moment, not a gotcha.",
        ],
        notes: ["If you're on Starter without the training add-on, you can still send one free trial phishing test to up to 3 named people with no roster setup — a good way to try it before upgrading."],
      },
    ],
  },

  {
    id: "evidence",
    title: "Evidence & Audit Readiness",
    icon: "🗂️",
    tier: "Growth and above",
    articles: [
      {
        id: "attach-evidence",
        title: "Keep proof on file for completed work",
        intro: "The Evidence tab tracks whether your completed remediation actually has documentation behind it — exactly what an auditor or insurer will ask for.",
        steps: [
          "The coverage banner shows what percentage of completed tasks have proof on file, color-coded (green 80%+, amber 50%+, red below).",
          "The \"Completed — proof missing\" list shows exactly which completed tasks still need it. Click \"Attach proof\" and add a short note.",
          "You can also add general evidence directly: a title, a note (a note alone counts), and optionally a file upload (PDF, image, text, CSV, Word, or Excel, up to 3.5MB). Every file gets a stored integrity hash.",
          "Download or delete any evidence item at any time.",
        ],
      },
    ],
  },

  {
    id: "reports",
    title: "Reports",
    icon: "📊",
    tier: "Growth and above",
    articles: [
      {
        id: "generate-reports",
        title: "Generate and download reports",
        intro: "The Reports tab covers two kinds of reports: some you generate yourself, and some your analyst delivers to you.",
        steps: [
          "You can generate a Status Report or an Update Report (optionally scoped to changes since a date you pick) any time, on demand.",
          "Compliance Report, Insurance Report, Legal Record, and Training Report are staff-delivered — you'll see them appear tagged \"From your analyst\" once one is sent, but you can't generate these yourself.",
          "Every report opens as a Word document. Reports you generated yourself can also be deleted.",
        ],
      },
    ],
  },

  {
    id: "mastermind",
    title: "Mastermind AI Chat",
    icon: "🧠",
    tier: "Starter and above",
    articles: [
      {
        id: "use-mastermind",
        title: "Ask Mastermind about your own program",
        intro: "Mastermind is your virtual-CISO assistant, grounded entirely in your own account's real data.",
        steps: [
          "Click \"🧠 Mastermind\" in the top bar and ask a question in plain language — about your posture score, endpoints, recommendations, compliance status, or anything else in your program.",
          "If you ask about a feature your plan doesn't include, Mastermind tells you plainly, explains what the feature does, and names the exact tier or add-on (with price) that would unlock it — it never fabricates or implies it can see data it doesn't have.",
        ],
        notes: ["Mastermind is advisory only. It never takes action on your systems or accounts — every recommendation is something you or your analyst act on."],
      },
    ],
  },

  {
    id: "analyst-chat",
    title: "Talking to Your Analyst / Support",
    icon: "💬",
    tier: "Direct in-app analyst chat: Guided and above. Support Center (Mastermind help chat + ticketed requests): Starter and above. Free tier reaches the team via the public Support form.",
    articles: [
      {
        id: "message-analyst",
        title: "Message your analyst",
        intro: "Click \"💬 Chat\" in the top bar for threaded messaging with your assigned ShieldAI analyst.",
        steps: [
          "Type your message and send — your analyst (or, if none is assigned yet, the ShieldAI team) is notified.",
          "The thread stays open for follow-up; check back for replies or wait for a notification.",
        ],
        notes: ["This direct in-app thread is a Guided-plan feature. On Starter and Growth, use the Support Center instead (see below) — or the public Support form for account or product questions."],
      },
      {
        id: "support-center",
        title: "Use the Support Center",
        intro: "Click \"🎫 Support\" in the top bar for an instant Mastermind answer or to open a ticketed support request — no assigned analyst required.",
        steps: [
          "\"Chat with Mastermind\" jumps straight into the same Mastermind assistant used elsewhere in the app, grounded in your own account.",
          "\"Submit a support request\" opens a ticket: pick a topic, describe what you need, and send. Whichever analyst is assigned to you (or, if none yet, the ShieldAI team) is notified and can reply from their own console.",
          "Your past requests are listed below the form, tagged Open or Resolved. Click one to see the full reply thread and add a follow-up — replying to a resolved request reopens it automatically.",
        ],
        notes: ["The Support Center is a Starter-plan feature. Free tier sees an upgrade prompt instead and should use the public Support form."],
      },
    ],
  },

  {
    id: "billing",
    title: "Plan & Billing",
    icon: "💳",
    tier: "Every plan",
    articles: [
      {
        id: "manage-plan",
        title: "Review or change your plan",
        intro: "The Plan & Billing tab is always available, regardless of your current tier.",
        steps: [
          "See your current plan, price, subscription status, renewal date, and any active add-ons.",
          "Click \"Manage Billing\" to open the Stripe customer portal (update payment method, view invoices).",
          "To upgrade, pick a higher tier in the plan comparison grid and click \"Upgrade\" — this goes through Stripe Checkout. Managed vCISO isn't self-serve; click \"Contact Sales\" instead.",
          "To add the Training Delivery add-on ($40/mo, Starter only — Growth and above already include it), click \"Add\" next to it.",
          "Downgrades aren't self-serve today — contact your ShieldAI admin to change to a lower tier.",
        ],
        notes: ["Anywhere in the app that a feature is locked for your tier, an upgrade prompt pops up automatically telling you exactly what plan or add-on unlocks it and for how much."],
      },
    ],
  },
];

// Flatten HELP_MANUAL into plain text for Mastermind's system prompt. Kept
// compact (short intros, numbered steps) rather than verbose prose, since
// this gets included in every client chat request's token budget.
export function manualAsText() {
  const lines = [];
  for (const section of HELP_MANUAL) {
    lines.push(`## ${section.title} (${section.tier})`);
    for (const a of section.articles) {
      lines.push(`### ${a.title}`);
      if (a.intro) lines.push(a.intro);
      (a.steps || []).forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      (a.notes || []).forEach(n => lines.push(`Note: ${n}`));
    }
  }
  return lines.join("\n");
}
