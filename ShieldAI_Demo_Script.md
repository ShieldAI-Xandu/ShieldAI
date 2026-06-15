# ShieldAI — Investor Demo Script
### 10–15 minutes · Mixed audience (business + technical) · Live or screen-share

---

## Before you start (setup checklist)

- [ ] Both servers running: `node server.js` and `npm run dev`
- [ ] Browser open to `localhost:5173`, **logged out**, window maximized, zoom ~100%
- [ ] Demo seed data freshly run (`node seedDemo.js`) — the 3 showcase companies exist
- [ ] Logins memorized:
  - **Client demo:** `demo@shieldai.com` / `ShieldDemo2026`
  - **Analyst console:** `analyst@xandultd.com` / `P@ssw0rd1234`
- [ ] Backup recording of the full flow saved locally (in case wifi/AI hiccups)
- [ ] Close other tabs, silence notifications, share only the browser window

**Golden rule:** Lead with the showcase accounts (instant, perfect). Only do *live* AI generation if you have time and a stable connection — and always have the recording ready.

---

## The arc (what you're proving)

1. There's a large, underserved market: small businesses that need a CISO but can't afford one.
2. ShieldAI delivers a real security program today — and the score is *defensible*, not AI guesswork.
3. The vision is a platform: engineers run many clients at scale, amplified by AI.
4. This is a business, not a feature.

Spend ~3 min on problem, ~6 min on demo, ~3 min on vision + business, ~3 min buffer/Q&A.

---

## PART 1 — The Problem (2–3 min, no screen yet)

> *Speak before showing anything. Eye contact, not the laptop.*

**Say something like:**

"Every business today is a target. But there's a massive gap in the market: a full-time Chief Information Security Officer costs $200,000 to $400,000 a year. A small or mid-sized business — a dental practice, a law firm, a manufacturer — can't afford that. Yet those same businesses are increasingly *required* to have a real security program: by their cyber-insurance providers, by their larger customers' vendor questionnaires, and by regulations like HIPAA and CMMC.

So they're stuck. Too big to ignore security, too small to afford expertise. Today they either do nothing and hope, or they pay a consultant $15,000 for a PDF that sits in a drawer.

ShieldAI closes that gap. We deliver a continuously-managed virtual CISO — powered by AI, overseen by security engineers — at a price a small business can actually pay."

**Transition:** "Let me show you what a business gets."

---

## PART 2 — The Product (the client experience) (4–5 min)

> *Screen on. Log in as `demo@shieldai.com`.*

### Beat 1 — The home dashboard
- You land on the **home screen** showing saved assessments.
- **Say:** "This is what a customer sees — their own security workspace. Let's open one. This is Meridian Dental Group, a 45-person dental practice handling patient health records."
- Click **Open Program** on Meridian.

### Beat 2 — The posture score (your differentiator — land this hard)
- Point to the **posture score (53) and the NIST CSF breakdown**.
- **Say:** "Here's what makes us different from 'ChatGPT for security.' This score isn't an AI guessing a number. It's computed by our own deterministic engine, built on the NIST Cybersecurity Framework — the federal standard. Every point traces to a specific control. *That's* why an insurer or an auditor can trust it."
- *(Technical people lean in here. This is the credibility moment.)*

### Beat 3 — The deliverables
- Click through 2–3 dashboard tabs quickly: **Priorities**, **Policies**, **Exec Report**.
- **Say:** "From one assessment, the business gets a prioritized roadmap, ready-to-use written policies, a tool stack, a training program, and an executive report — the full output of a CISO engagement."

### Beat 4 — Professional policy generation
- Go to **Policy Library** → open a saved policy (or generate one live if connection is solid).
- **Say:** "Each policy is a complete, professionally-formatted document — Purpose, Scope, Roles, Compliance, Revision History — that they can download as Word and use immediately. Tailored to their business, not a generic template."

**Transition:** "That's the self-serve product — our wedge into the market. But here's where it becomes a *platform*."

---

## PART 3 — The Platform Vision (the analyst console) (3–4 min)

> *Sign out. Log in as `analyst@xandultd.com`. (Note the 'Vision Mockup' framing — be honest it's forward-looking.)*

### Beat 5 — The command center
- You land in the **Portfolio Command Center**.
- **Say:** "This is the future — and it's how we scale. This is the console our cybersecurity engineers use to run security programs for a whole portfolio of clients at once. Recurring revenue per client, average security posture, agent fleet status, what needs attention — all in one place."
- Point to the **Agent Fleet** legend (green/yellow/red).

### Beat 6 — A live client command center
- Click into **Apex Manufacturing** (the at-risk one with the red 'No Comms' agent).
- **Say:** "Each client gets a full command center. Here's their security posture trending over twelve months. A live threat feed from an agent we deploy in their network. Direct messaging with the client. A review queue where our engineer approves the AI's work before it goes out — that human-in-the-loop is our quality bar and our liability protection."

### Beat 7 — Mastermind (the closer for the vision)
- Click **✦ Mastermind**. Run **🔧 Diagnose agent issue** on Apex.
- **Say:** "And our engineers aren't alone — they have an AI co-pilot. Mastermind reads this client's live data and walks the engineer through diagnosing the problem, triaging threats, closing compliance gaps. This is the leverage: one engineer, amplified by AI, can manage what used to take a whole team."

**Transition:** "So that's the arc: an affordable product today, a scalable platform tomorrow."

---

## PART 4 — The Business (2–3 min, screen optional)

**Hit these points (adapt to your actual numbers):**

- **The wedge:** Self-serve product gets businesses in the door cheaply and proves value.
- **The expansion:** They graduate to managed plans — recurring revenue per client (show the MRR figures in the console: $450 self-serve up to $2,400 managed).
- **The moat:** Our scoring methodology is proprietary IP; the human-in-the-loop workflow and accumulated client data compound over time. We're not a thin wrapper on someone's API.
- **Why now:** Cyber-insurance requirements, vendor security questionnaires, and regulation (CMMC, etc.) are *forcing* small businesses to act — demand is being created by external pressure, not just awareness.

**The ask:** State what you're raising and what it funds (e.g., "We're raising [X] to hire our first security engineers and convert this analyst console from mockup to live product").

---

## PART 5 — Anticipated Q&A (prep, don't script)

**"What stops OpenAI or a competitor from doing this?"**
> "The AI is the easy part. Our defensibility is three things: our proprietary NIST scoring methodology, the engineer-in-the-loop workflow that makes the output trustworthy enough to sell, and the client data and relationships that compound. A generic chatbot can't give a business something their insurer will accept."

**"Who's liable if your AI is wrong and a client gets breached?"**
> "That's exactly why our model has a human security engineer review and approve every deliverable before it reaches the client — that's what the analyst console's review queue does. The AI accelerates our experts; it doesn't replace their judgment or accountability. We also scope the self-serve tier appropriately with clear terms."

**"How is the score actually calculated?"** *(technical)*
> "Five NIST CSF functions — Identify, Protect, Detect, Respond, Recover — each weighted, with factors scored from a structured assessment. It's fully deterministic: same inputs, same score, every point explainable. Happy to walk through the engine."

**"What's real today vs. mockup?"**
> *Be honest.* "The client product — assessment, scoring, program and policy generation, accounts — is live and working, as you just saw. The analyst console is a working mockup of where we're going; the data structures behind it are real, and converting it to live is exactly what this raise funds."

**"What's your traction / pricing?"**
> *Have your real answer ready — even 'we're pre-revenue, here's our pilot plan' is fine if delivered with confidence.*

---

## If something breaks (stay calm)

- **AI generation hangs or errors** → "Generation normally takes a moment — let me show you a completed one," and switch to a showcase account or the recording. Never wait on a spinner in silence.
- **Login issue** → you have both accounts memorized; if one fails, pivot to the other view.
- **Total tech failure** → switch to the backup recording and narrate over it. The story matters more than the live pixels.

---

## One-line summary to open or close with

> "A full-time CISO costs a quarter-million dollars a year. ShieldAI gives a small business that same protection — AI-powered, expert-reviewed — for the price of a software subscription. And the platform lets a handful of our engineers protect thousands of businesses."
