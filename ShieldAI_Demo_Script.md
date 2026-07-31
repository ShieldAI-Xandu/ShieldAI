# ShieldAI — Investor Demo Script
### 12–18 minutes · Mixed audience (business + technical) · Live or screen-share
### Updated for the current access-code demo sandbox (endpoints, tasks, vendor risk, training delivery, phishing simulation, compliance calendar, white-label branding, real CVE/dark-web exposure, and a genuinely live analyst console)

---

## Before you start (setup checklist)

- [ ] Backend running (`node server.js`) — confirm `/health` returns 200
- [ ] Demo sandbox freshly seeded: `node seedDemo.js` (safe to re-run any time; it wipes and rebuilds the demo store only — never touches real client data in `db.json`)
- [ ] You have an **investor-type access code**. If you don't have one yet:
  1. Log into the admin console as `dbrooks@xandultd.com`.
  2. Go to **Leads**, find (or submit yourself as) a lead, click **Approve**, choose access type **Investor**.
  3. Copy the code shown (format `SHLD-XXXX-XXXX`) — investor codes are valid 96 hours.
- [ ] Browser open to the marketing site, **logged out**, window maximized
- [ ] Backup recording of the full flow saved locally (in case wifi/AI hiccups)
- [ ] Close other tabs, silence notifications, share only the browser window

**Golden rule:** The whole demo runs inside one continuous session now — one access code takes you into the analyst console, and "View as Client →" from inside it drops you into the client experience without logging out. No juggling two logins.

**What changed since the last version of this script:** there is no more `demo@shieldai.com` login. The public demo is access-code gated (`Investors and prospective clients receive a code after requesting access`), and the code you redeem determines what you see: an **investor** code lands you in the real analyst console (with full "View as Client" access to the one seeded client); a **client** code lands you only in the client dashboard. The analyst console is also no longer a "vision mockup" — it's live, working software now. Adjust your language accordingly; you're not asking anyone to imagine anything.

---

## The arc (what you're proving)

1. There's a large, underserved market: small businesses that need a CISO but can't afford one.
2. ShieldAI delivers a real, defensible security program today — not AI guesswork.
3. The analyst console is a **working platform today**, not a vision — one engineer, amplified by AI, running a whole portfolio.
4. Real data everywhere it's claimed as real: real NVD CVE records, real breach-database structure (clearly flagged as simulated for a fictional company), a deterministic scoring engine, and an agent that catches clients being wrong about their own environment.
5. This is a business, not a feature.

Spend ~2 min on problem, ~4 min on the client product, ~7 min on the analyst platform (this is now the strongest section), ~3 min on business + Q&A.

---

## PART 1 — The Problem (2 min, no screen yet)

> *Speak before showing anything.*

"Every business today is a target. But there's a massive gap in the market: a full-time Chief Information Security Officer costs $200,000 to $400,000 a year. A small or mid-sized business can't afford that. Yet those same businesses are increasingly *required* to have a real security program — by cyber-insurance providers, by their larger customers' vendor questionnaires, and by regulations like HIPAA and CMMC.

So they're stuck. Too big to ignore security, too small to afford expertise. ShieldAI closes that gap: a continuously-managed virtual CISO, powered by AI, overseen by real security engineers, at a price a small business can actually pay."

**Transition:** "Let me show you what a business gets — then I'll show you how we run it."

---

## PART 2 — The Client Product (4–5 min)

> *Screen on. Go to the site → click Investors → Enter with a code → redeem your investor code.*
> You'll land in the analyst console (this is what an investor code does). Click **🖥️ View as Client →** on the one seeded client, "ShieldAI Demo Workspace," to enter the client experience.

### Beat 1 — Pick a company, land on the posture score
- Inside the client view, open the **Apex Manufacturing** assessment/program (the weakest of the three seeded companies — the most dramatic, most useful one to open with).
- **Say:** "This is one of three sample companies loaded into the sandbox — a mid-size manufacturer chasing a defense contract that requires CMMC. Here's their posture score."
- Point to the **NIST CSF breakdown**.
- **Say:** "This isn't an AI guessing a number. It's computed by our own deterministic engine against the NIST Cybersecurity Framework. Same answers, same score, every time — every point traces to a specific control. That's the difference between us and 'ChatGPT for security,' and it's why an insurer or auditor can trust it."

### Beat 2 — The deliverables
- Click through **Priorities**, **Policies**, **Compliance**, **Exec Report**.
- **Say:** "From one assessment, the business gets a prioritized roadmap, ready-to-use written policies with real revision history, a full compliance gap analysis, and an executive report — the output of a real CISO engagement, generated in minutes."

### Beat 3 — Endpoint monitoring catches a lie (this is the moment — land it hard)
- Open **Endpoints** / the monitoring agent fleet view.
- **Say:** "We don't just take a client's word for it. This company told us, on their intake questionnaire, that *some* of their systems have disk encryption enabled. Our read-only monitoring agent reports on their actual endpoints — and it found *zero*. That's not a bug, that's the product working: the agent informs, the questionnaire doesn't get silently overridden, but now a human knows exactly where the real risk is instead of trusting a guess."
- *(This is the single best "we're not just an AI wrapper" moment in the whole demo — it's a genuine, structural product feature: agent-vs-questionnaire corroboration.)*

### Beat 4 — Remediation tasks with a real, computed payoff
- Open **Tasks** (remediation board).
- **Say:** "Every fix is tied to a specific control, and we can tell you exactly how many posture points completing it is worth — *before* they do the work — because the scoring engine is deterministic. Two of these are already marked complete, and you can see the before/after score move in real time."

### Beat 5 — Vendor risk, training, phishing simulation
- Open **Vendor Risk** — point at the mix of overdue / due soon / current vendors.
- Open **Training** — a real learner roster, real completion rates, and real AI-generated lesson content (not a stub).
- Open **Phishing Simulation** — two campaigns, and the click-through rate genuinely improved between rounds.
- **Say:** "This is the ongoing management layer — vendor reassessment cadence, employee training with real completion tracking, and phishing simulations. Same story every time: real, gradeable outcomes, not vanity metrics."

**Transition:** "That's the self-serve product — the wedge. Now let me show you why this is a platform, not a feature."

---

## PART 3 — The Analyst Platform (this is real now, not a mockup) (6–7 min)

> *You're already in the analyst console from Part 2 — click "Exit client view" / back out of the impersonation.*

### Beat 6 — The portfolio command center
- **Say:** "This is the console our security engineers actually use, live, to run every client in their book from one screen — assigned clients, posture, endpoint health, open recommendations, compliance status. This used to be a mockup in earlier decks. It's real now."
- Point to the sort order: at-risk clients surface first, automatically.

### Beat 7 — The recommendation lifecycle (advisory, never autonomous)
- Open the client's **recommendations queue**.
- **Say:** "Watch the full lifecycle: our AI layer drafts a recommendation from what the monitoring agent found — severity, priority, plain-language rationale. An analyst reviews and forwards it to the client. The client decides: handle it themselves, permit the analyst to do it, or decline. Only *then* can an analyst act, and only within what the client explicitly permitted. The AI never performs an action on a client's system — ever. That boundary is enforced in the backend, not just the UI."
- *(This is the other core credibility beat: "AI advises, humans act" is a hard architectural boundary in this codebase, not a policy on paper.)*

### Beat 8 — Mastermind: a real AI co-pilot with real tools
- Open **Mastermind** in the analyst console. Ask it something like: *"Which of my clients needs the most attention right now, and why?"* or *"What's Apex Manufacturing's biggest compliance gap?"*
- **Say:** "Mastermind isn't a chatbot with a system prompt. It has read-only tools — it can pull a client's real CVE exposure, run a gap analysis, check compliance against 12 real frameworks, compare agent telemetry against the questionnaire — on demand, live, scoped to exactly the clients this analyst is assigned to. It's advisory only, same as the rest of the platform: it recommends, it never acts."

### Beat 9 — Real threat intelligence
- Open **Threat Intel** — CVE exposure and dark-web/breach exposure.
- **Say:** "The CVE data here is live — pulled from the real NIST National Vulnerability Database against this company's actual reported software stack. Every CVE ID you see is real and checkable at nvd.nist.gov. The breach data is necessarily simulated, since this is a fictional company HIBP has never heard of — and it's explicitly flagged `simulated: true` in the data itself. We never fabricate a finding and we never hide that something's simulated. That's a policy we enforce in code, not just in a deck."

### Beat 10 — White-label, and analyst-client isolation
- Point out the branding on the client view (if you showed it in Part 2) — "Meridian Risk Advisors."
- **Say:** "An MSP or security firm can run this under their own brand. And critically — an analyst only ever sees the clients assigned to them. That isolation is enforced at every layer of the backend, not just hidden in the UI. That's the other hard boundary this platform doesn't compromise on."

**Transition:** "So the arc: an affordable, real product today, and a platform an analyst is actually running live, right now, in this sandbox."

---

## PART 4 — The Business (2–3 min, screen optional)

**Hit these points (current pricing, confirm before the call in case it's changed):**

- **Tiers:** Free → Starter ($159/mo) → Growth ($349/mo, most popular) → Guided ($699/mo, periodic engineer review) → Managed vCISO ($1,950/mo, full-service, unlimited endpoints) — all still well under a full-time CISO's cost.
- **The wedge:** Free assessment + posture score gets businesses in the door; self-serve tiers monetize the program-builder; Managed is the white-glove, highest-margin tier.
- **The moat:** the deterministic NIST scoring methodology, the human-in-the-loop workflow that makes AI output trustworthy enough to sell, and the accumulated client data — not a thin wrapper on someone else's API. Three real providers under the hood (Claude, Gemini, GPT-4o), each honestly routed to its documented strength, with real fallback — that's disclosed, not hidden.
- **Why now:** cyber-insurance requirements, vendor security questionnaires, and regulation (CMMC, HIPAA, SOC 2) are *forcing* small businesses to act.

**The ask:** state what you're raising and what it funds.

---

## PART 5 — Anticipated Q&A (prep, don't script)

**"What stops a competitor — or OpenAI itself — from doing this?"**
> "The AI is the easy part. Our defensibility is the deterministic scoring methodology, the engineer-in-the-loop workflow that makes the output trustworthy enough for an insurer or auditor to accept, the hard architectural boundaries (analyst isolation, AI-advises-humans-act) that are enforced in the backend, and the client data and relationships that compound over time."

**"Who's liable if the AI is wrong and a client gets breached?"**
> "The AI never acts on a client's systems — it drafts recommendations that a human analyst reviews, and the client explicitly decides who's allowed to act and how. That review queue you saw isn't cosmetic; it's how liability and quality control both work here."

**"Is the analyst console still a mockup?"**
> "No — that's the update since the last time you might have seen this. It's live: real assigned-client scoping, a real recommendation lifecycle, a real Mastermind AI with tool access, real endpoint monitoring. What you're watching right now is production code, not a prototype."

**"How is the score actually calculated?"** *(technical)*
> "Five NIST CSF functions — Identify, Protect, Detect, Respond, Recover — each weighted, scored from a structured assessment. Fully deterministic: same inputs, same score, every point explainable."

**"What's real today vs. still being built?"**
> *Be honest.* "Everything you just saw is real and running: assessment, scoring, program/policy generation, endpoint monitoring, the recommendation lifecycle, vendor risk, training delivery, phishing simulation, real CVE data, and the analyst console. Billing/Stripe integration is deferred by design for now — a demo account bypasses it — but the security product itself is fully live."

**"What's your traction / pricing?"**
> *Have your real numbers ready.*

---

## If something breaks (stay calm)

- **An AI-generated section is slow or errors** → the sandbox's 3 companies were pre-generated during seeding specifically so you never have to wait on a live call — if you accidentally trigger a fresh generation, switch to a different already-loaded company or the recording.
- **Access code expired or won't redeem** → mint a fresh one from the admin Leads tab (investor codes last 96 hours) or pivot to the recording.
- **Total tech failure** → switch to the backup recording and narrate over it. The story matters more than the live pixels.

---

## One-line summary to open or close with

> "A full-time CISO costs a quarter-million dollars a year. ShieldAI gives a small business that same protection — real threat intelligence, a deterministic score, expert-reviewed recommendations — for the price of a software subscription. And what you just watched wasn't a pitch for a platform — it's the platform, live, today."
