# ShieldAI — Secrets & Key Rotation

## Every secret ShieldAI uses

Pulled from the code, not from memory — this is every `process.env` secret the
app actually reads.

| Variable | Provider | Required? | If missing | Rotate at |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | **Yes** | Mastermind + generation fall back or fail | https://console.anthropic.com/settings/keys |
| `GEMINI_API_KEY` | Google AI Studio | No | Falls back to another provider | https://aistudio.google.com/apikey |
| `OPENAI_API_KEY` | OpenAI | No | Falls back to another provider | https://platform.openai.com/api-keys |
| `JWT_SECRET` | ShieldAI | **Yes** | Sessions use an insecure default | Generate a new random value |
| `DEMO_JWT_SECRET` | ShieldAI | No | Derived from `JWT_SECRET` | Generate a new random value |
| `HIBP_API_KEY` | Have I Been Pwned | For breach monitoring | Monitoring reports "Not active" | https://haveibeenpwned.com/API/Key |
| `NVD_API_KEY` | NIST NVD | No | CVE lookups ~78s instead of ~8s | https://nvd.nist.gov/developers/request-an-api-key |
| `STRIPE_SECRET_KEY` | Stripe | For billing | Billing routes return 503 | https://dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | Stripe | For billing | Webhooks rejected | https://dashboard.stripe.com/webhooks |

Non-secret config: `ADMIN_EMAIL`, `ANALYST_EMAIL`, `APP_URL`, `PORT`, `HOST`,
`DB_DIR`, `HIBP_USER_AGENT`, `SEED_DEMO_ON_BOOT`, `SEED_DEMO_FORCE`.

## When to rotate

Rotate immediately if a key has ever been:

- committed to git (**even if later deleted** — history keeps it)
- pasted into a chat, ticket, doc, or AI tool
- included in a file shared with anyone
- present on a machine you no longer control
- in an `.env` uploaded anywhere

Otherwise: **every 90 days** for provider keys, and whenever someone with access
leaves.

> Deleting a secret from a file does **not** un-leak it. Rotation is the only
> fix. Assume anything exposed was captured.

## Rotation procedure

Same shape for every provider. The order matters: create the new key **before**
revoking the old one, or you take an outage.

**1. Create the new key** at the provider (see table above). Never reuse a name
   like "production" — date it, e.g. `shieldai-prod-2026-07`.

**2. Set it on Railway** — Variables tab → update the value → this triggers a
   redeploy automatically.

**3. Verify the new key works before revoking the old one:**
   - `ANTHROPIC_API_KEY` → open Mastermind, send a message
   - `GEMINI_API_KEY` / `OPENAI_API_KEY` → same, they're the fallback chain
   - `HIBP_API_KEY` / `NVD_API_KEY` → Admin → **Threat Intel** → *Run live probe*
   - `STRIPE_SECRET_KEY` → Admin → Billing loads without error
   - `JWT_SECRET` → log out and back in

**4. Revoke the old key** at the provider. Don't skip this — an unrevoked
   leaked key is still a live credential.

**5. Record it**: date, which key, why. A rotation you can't prove happened is a
   rotation you'll re-litigate later (as this project already has).

### JWT secrets are different

Rotating `JWT_SECRET` **invalidates every active session** — everyone gets logged
out. That's expected. Generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`DEMO_JWT_SECRET` must be **different** from `JWT_SECRET`. If they matched, a
demo token could be verified as a production token and the sandbox isolation
would collapse.

## Scanning for leaks

```powershell
node scanSecrets.js              # working tree
node scanSecrets.js --staged     # only what's staged
node scanSecrets.js --history    # also past commits (slow, thorough)
```

Findings are **masked** — the scanner never prints a live secret, because that
would just move the leak into your terminal history.

It flags three escalating states:

- *(plain)* — on disk only
- **[TRACKED BY GIT]** — committed; if pushed, it's published → **rotate**
- **[IN GIT HISTORY]** — was committed at some point, even if deleted → **rotate**

### Block leaks before they happen

```powershell
cd E:\ShieldAI
echo node scanSecrets.js --staged > .git\hooks\pre-commit
```

On Windows, make sure the hook file has no `.txt` extension. The hook exits 1 on
a finding, which aborts the commit.

## Rules that prevent most of this

1. **Secrets live in Railway Variables. Nowhere else.** Not `.env` in the repo,
   not a `.txt` file, not a chat message.
2. **`.env` stays gitignored.** Never rename it to dodge the ignore rule —
   `_env` is exactly how the previous leak happened.
3. **Never upload `.env` to an AI tool, including this one.** Describe the
   variable, don't paste the value.
4. **Use `.env.example`** with empty or placeholder values to document what's
   needed. That file is safe to commit.
5. **Don't email or Slack keys.** Use the provider's own sharing, or a secret
   manager.

## Rotation log

Keep this current. It's the difference between "I think we rotated" and knowing.

| Date | Key | Reason | Old key revoked? | By |
|---|---|---|---|---|
| 2026-07 | `ANTHROPIC_API_KEY` | Exposed in `_env` uploaded to a Claude project | ✅ | Derrick |
| 2026-07 | `GEMINI_API_KEY` | Exposed in `_env` and `ShieldAI_key.txt` | ✅ | Derrick |
| | | | | |

## Outstanding cleanup

- [ ] Remove `_env` from the Claude project knowledge base (contains the old,
      now-revoked keys — no live risk, but it keeps resurfacing the question)
- [ ] Remove `ShieldAI_key.txt` from the project knowledge base
- [ ] Delete `E:\ShieldAI\ShieldAI_key.txt` locally if it still exists
- [ ] Install the pre-commit hook
- [ ] Confirm `DEMO_JWT_SECRET` is set and differs from `JWT_SECRET`
