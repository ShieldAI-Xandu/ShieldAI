// aiProviders.js
// Registry + routes for additional AI providers.
//
// ShieldAI currently runs on Anthropic (Claude) for all live generation.
// Gemini, ChatGPT (OpenAI), and Perplexity are SCAFFOLDED but INACTIVE — the
// routes exist so the surface is stable and discoverable, but they do not call
// any external API and cannot be enabled by accident. Each returns a clear
// "not yet available" response.
//
// Activating a provider later is deliberate and explicit: implement its call
// function, set its env key, and flip `active: true` in the registry (guarded
// by the presence of the key). Nothing here fabricates a response or silently
// falls back to another provider.

export const AI_PROVIDERS = {
  anthropic: {
    id: "anthropic",
    name: "Claude (Anthropic)",
    active: true,                 // the only live provider today
    role: "Primary — assessment intake, program generation, Mastermind",
    envKey: "ANTHROPIC_API_KEY",
  },
  gemini: {
    id: "gemini",
    name: "Gemini (Google)",
    active: false,                // scaffolded, not serviced yet
    role: "Planned — threat-intel summarization",
    envKey: "GEMINI_API_KEY",
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT (OpenAI)",
    active: false,                // scaffolded, not serviced yet
    role: "Planned — report drafting",
    envKey: "OPENAI_API_KEY",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    active: false,                // scaffolded, not serviced yet
    role: "Planned — live research / citations",
    envKey: "PERPLEXITY_API_KEY",
  },
};

// A provider counts as available only if it's explicitly marked active AND its
// key is present. This double gate means flipping `active: true` alone won't
// expose a broken integration — the key must also be configured.
export function providerAvailable(id) {
  const p = AI_PROVIDERS[id];
  if (!p || !p.active) return false;
  return !!process.env[p.envKey];
}

// Public-facing status (never leaks key values — only whether one is present).
export function providerStatus() {
  return Object.values(AI_PROVIDERS).map(p => ({
    id: p.id,
    name: p.name,
    role: p.role,
    active: p.active,
    available: providerAvailable(p.id),
    status: !p.active ? "coming_soon" : (providerAvailable(p.id) ? "active" : "needs_configuration"),
  }));
}

export function registerAiProviderRoutes(app, { requireAuth }) {
  // Status of all providers — for a settings/admin "AI integrations" view.
  app.get("/api/ai/providers", requireAuth, (req, res) => {
    res.json({ providers: providerStatus() });
  });

  // Inactive provider endpoints. They intentionally do NOT call any external
  // API. Each returns 503 with a clear, honest message so the frontend can show
  // "coming soon" instead of appearing wired up.
  function inactiveHandler(id) {
    return (req, res) => {
      const p = AI_PROVIDERS[id];
      res.status(503).json({
        provider: id,
        active: false,
        error: `${p ? p.name : id} is not available yet. This integration is planned but not currently serviced.`,
        status: "coming_soon",
      });
    };
  }

  // Scaffolded routes — present but inactive.
  app.post("/api/ai/gemini", requireAuth, inactiveHandler("gemini"));
  app.post("/api/ai/chatgpt", requireAuth, inactiveHandler("chatgpt"));
  app.post("/api/ai/perplexity", requireAuth, inactiveHandler("perplexity"));
}
