// aiProviders.js
// Unified AI provider layer for ShieldAI.
//
// One entry point — callAI({ provider, system, messages, max_tokens }) — that
// dispatches to Claude (Anthropic), Gemini (Google), or GPT (OpenAI), each
// with its own request/response shape absorbed here so the rest of the app
// stays provider-agnostic.
//
// FALLBACK POLICY (by design): if a requested provider has no API key, or its
// call fails for any reason, we SILENTLY fall back to Claude. The app must
// keep working end-to-end regardless of which third-party keys are present.
// Claude itself has no fallback — if Claude is unconfigured, that's a real
// error the caller must handle.
//
// Keys (from .env):
//   ANTHROPIC_API_KEY   (required — the fallback + default engine)
//   GEMINI_API_KEY      (optional — enables real Gemini)
//   OPENAI_API_KEY      (optional — enables real GPT)

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const GEMINI_MODEL    = process.env.GEMINI_MODEL    || "gemini-2.5-flash";
const OPENAI_MODEL    = process.env.OPENAI_MODEL    || "gpt-4o";

// Normalize a provider id from either the frontend labels (claude/gemini/gpt4)
// or common aliases, to one of: "claude" | "gemini" | "openai".
export function normalizeProvider(p) {
  const v = String(p || "").toLowerCase();
  if (v === "gemini" || v === "google") return "gemini";
  if (v === "gpt" || v === "gpt4" || v === "gpt-4o" || v === "openai" || v === "chatgpt") return "openai";
  return "claude";
}

// Which providers are actually usable right now (key present).
export function providerStatus() {
  return {
    claude: { configured: !!process.env.ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
    gemini: { configured: !!process.env.GEMINI_API_KEY,    model: GEMINI_MODEL },
    openai: { configured: !!process.env.OPENAI_API_KEY,    model: OPENAI_MODEL },
  };
}

// ── Anthropic (Claude) ──────────────────────────────────────────
async function callClaudeRaw({ system, messages, max_tokens = 1500 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens, system, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data?.content?.map(c => c.text || "").join("") || "";
}

// ── Google (Gemini) ─────────────────────────────────────────────
// Gemini uses: system in `systemInstruction`, user/assistant turns as
// `contents` with role "user"/"model", API key in the URL query param.
async function callGeminiRaw({ system, messages, max_tokens = 1500 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const contents = (messages || []).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: String(system) }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").join("") || "";
}

// ── OpenAI (GPT) ────────────────────────────────────────────────
// OpenAI uses: system as the first message with role "system",
// Authorization: Bearer header, text at choices[0].message.content.
async function callOpenAIRaw({ system, messages, max_tokens = 1500 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const msgs = [];
  if (system) msgs.push({ role: "system", content: String(system) });
  for (const m of messages || []) {
    msgs.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, max_tokens, messages: msgs }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

// ── Unified entry point ─────────────────────────────────────────
// Returns { text, provider, fallback } where `provider` is the engine that
// actually answered and `fallback` is true if we fell back to Claude.
export async function callAI({ provider, system, messages, max_tokens = 1500 }) {
  const want = normalizeProvider(provider);

  // Claude path (also the fallback target).
  if (want === "claude") {
    const text = await callClaudeRaw({ system, messages, max_tokens });
    return { text, provider: "claude", fallback: false };
  }

  const runner = want === "gemini" ? callGeminiRaw : callOpenAIRaw;
  const keyPresent = want === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.OPENAI_API_KEY;

  // No key → silent fallback to Claude (by design).
  if (!keyPresent) {
    const text = await callClaudeRaw({ system, messages, max_tokens });
    return { text, provider: "claude", fallback: true };
  }

  // Key present → try the real provider; on ANY failure, silently fall back.
  try {
    const text = await runner({ system, messages, max_tokens });
    return { text, provider: want, fallback: false };
  } catch (err) {
    console.warn(`[aiProviders] ${want} failed, falling back to Claude: ${err.message}`);
    const text = await callClaudeRaw({ system, messages, max_tokens });
    return { text, provider: "claude", fallback: true };
  }
}

// Convenience: text-only, provider-agnostic. Drop-in for callClaudeText but
// with an optional provider. Defaults to Claude when no provider given.
export async function callAIText({ provider, system, messages, max_tokens }) {
  const { text } = await callAI({ provider, system, messages, max_tokens });
  return text;
}
