# ShieldAI — Pricing & Unit Economics: What the Model Says

Built from your codebase and Business Plan. Open `ShieldAI_Unit_Economics.xlsx`
— blue cells are inputs, yellow are the assumptions that most change the answer.

---

## 1. Your AI cost assumption is 50× too pessimistic

The Business Plan assumes **~$15/client/month** for AI + infrastructure.
Computed from your actual code — 10 sections × ~6k tokens, 6 policies × ~5k
tokens, 8 Mastermind messages × ~4k tokens, at ~$6/M blended:

| | Real cost |
|---|---|
| Onboarding (full program + policies) | **$0.54 one-time** |
| Ongoing per client per month | **$0.28** |

Even at 10× my token estimates you're under $3/client/month. **AI is not a cost
driver in this business.** Engineer time is. That's worth correcting in the plan
— it makes your margins better, not worse, and an investor who checks will find
the $15 unexplained.

I've kept conservative per-tier AI figures ($6–$18) in the model as buffer.

---

## 2. $159 works — and it works at a much higher CAC than you'd think

At $159/mo, gross profit is **$136/client/month** (86% gross margin, no engineer
time). The question isn't whether $159 covers costs — it's whether it covers
*acquisition*.

**Maximum CAC $159 can absorb:**

| Churn | Lifetime | Max CAC @ 3x LTV:CAC | Max CAC @ 12mo payback |
|---|---|---|---|
| 4.5%/mo | 22 mo | **$1,008** | $1,633 |
| 6.0%/mo | 17 mo | **$756** | $1,633 |
| 8.0%/mo | 12 mo | **$567** | $1,633 |

**LTV:CAC at $159 across scenarios:**

| Churn ↓ / CAC → | $400 | $800 | $1,200 | $1,800 |
|---|---|---|---|---|
| 3.0%/mo | 11.3x | 5.7x | 3.8x | 2.5x ⚠ |
| 4.5%/mo | 7.6x | 3.8x | 2.5x ⚠ | 1.7x ⚠ |
| 6.0%/mo | 5.7x | 2.8x ⚠ | 1.9x ⚠ | 1.3x ✖ |
| 8.0%/mo | 4.3x | 2.1x ⚠ | 1.4x ✖ | 0.9x ✖ |

**Verdict: $159 is defensible.** It only breaks if churn exceeds ~6%/mo *and*
CAC exceeds ~$800. Both are plausible for SMB self-serve — which is why they're
the two numbers to instrument first.

---

## 3. The recommended ladder

I've modelled five tiers rather than your four. The addition is **Growth at
$349** — the gap between $159 and $699 is where most SMBs actually sit, and
nothing currently catches them.

| Tier | Price | Gross margin | LTV:CAC | Payback | What it's for |
|---|---|---|---|---|---|
| Free | $0 | — | — | — | Acquisition. Assessment + score. |
| **Starter** | **$159** | 86% | 7.6x | 2.9 mo | Beats Trava's $99 on substance, not price. |
| **Growth** | **$349** | 76% | 14.7x | 1.5 mo | Agent + CVE/breach intel + quarterly review. |
| **Guided** | **$699** | 65% | 16.8x | 4.0 mo | Engineer review, compliance tracking. |
| **Managed** | **$1,950** | 57% | 40.8x | 1.6 mo | Engineer runs it. FTC Qualified Individual. |

**Growth at $349 is the most important addition.** It's the first tier where the
monitoring agent, live NVD data, and breach monitoring justify their existence —
and it's priced under the $500 "commodity" line Cynomi warns MSPs about while
being unreachable for them.

**On Trava's $99:** don't match it. At $99 gross profit drops to ~$79/mo, which
caps CAC at ~$580 at 4.5% churn. You'd be buying a price war against a funded
competitor with a worse product. Compete on the four control-mapped frameworks.

---

## 4. The Business Plan's ~75% margin needs a caveat

The plan states ~75% gross margin. The model says:

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| ARR | $1.12M | $4.55M | $12.81M |
| **Gross margin** | **59.3%** | **61.0%** | **61.2%** |
| Net margin after CAC | ~52% | ~55% | ~56% |
| Engineers required | 2 | 8 | 23 |

The 75% figure is the **Managed tier gross margin in isolation**. Blended across
a realistic tier mix it's ~60%. That's still a good SaaS margin — but stating 75%
company-wide invites a correction in diligence.

**Also note: engineers required is 23 by Year 3, not 11.** The plan's ~25
clients/engineer only holds if Guided clients need ~2 hrs/month. If they need 4,
headcount roughly doubles. That's the single biggest swing factor in the model
and it deserves real measurement once you have engineers.

---

## 5. What isn't known — and must be

The model is only as good as three numbers the plan doesn't have:

| Input | Model uses | Status |
|---|---|---|
| **CAC (self-serve)** | $400 | **Unvalidated guess.** |
| **Monthly churn** | 4.5% | **Unvalidated guess.** |
| **Free → paid conversion** | 8% | **Unvalidated guess.** |

Your pitch outline has `[ ] target LTV / CAC` as an open bracket. Investors ask
this. The honest answer today: *"$159 supports CAC up to ~$1,000 at 4.5% churn —
here's the model. Validating those two numbers is what the first tranche buys."*

That's a stronger answer than a fabricated LTV:CAC.

**Instrument these before anything else:** cost per paying signup, month-2 and
month-6 retention, and free→paid conversion.

---

## 6. Answering your original question

> *"What pricing would allow us to run the business with healthy profit margins?"*

- **$159 Starter works** at any CAC below ~$1,000 with churn at/below 4.5%
- **Minimum viable Starter price is ~$74** at $400 CAC — you have 2× headroom
- **Add Growth at $349** — biggest revenue-per-client gain for least effort
- **Keep Managed at $1,950** — 40x LTV:CAC, still below the $2,500 market floor
- **Blended gross margin ~60%**, not 75% — correct the plan
- **The binding constraint is churn, not price.** At 4.5% you have room
  everywhere; at 8% the whole self-serve tier gets marginal. Retention is the
  metric to build for.
