// cli/lib/claudeToolLoop.js
// Raw-fetch Claude tool-use loop for the read-only `ask` assistant — mirrors
// server.js's callClaudeWithTools shape (same request/tool_use/tool_result
// loop, same model) rather than pulling in a second Anthropic SDK alongside
// the Agent SDK already used by `code`. Reads ANTHROPIC_API_KEY from this
// machine's environment (the admin's own shell), not from the server.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

export async function callClaudeWithTools({ system, messages, tools, runTool, maxTokens = 1500, maxTurns = 6 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set in this shell's environment.");
  }

  let convo = messages.map(m => ({ role: m.role, content: m.content }));

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: convo, tools }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    const blocks = data?.content || [];
    const toolCalls = blocks.filter(b => b.type === "tool_use");

    if (toolCalls.length === 0) {
      return blocks.map(b => b.text || "").join("");
    }

    convo.push({ role: "assistant", content: blocks });
    const resultBlocks = [];
    for (const call of toolCalls) {
      let resultContent;
      try {
        const result = await runTool(call.name, call.input || {});
        resultContent = JSON.stringify(result ?? { note: "No result." });
      } catch (err) {
        resultContent = JSON.stringify({ error: `Tool failed: ${err.message}` });
      }
      resultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: resultContent });
    }
    convo.push({ role: "user", content: resultBlocks });
  }

  return "Reached the turn limit without a final answer — try a narrower question.";
}
