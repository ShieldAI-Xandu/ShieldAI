// cli/lib/confirm.js
// The one reusable human-confirmation gate. "AI advises, humans act" means
// every action with an external effect (file edit, git commit/push, PR
// creation, admin write) routes through one of these two functions — never
// auto-approved, never a default-yes.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function ask(promptText) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(promptText)).trim();
  } finally {
    rl.close();
  }
}

// Ordinary gate: bare "y"/"yes" (case-insensitive) approves; anything else,
// including a blank Enter, declines.
export async function confirm({ message, detail }) {
  if (detail) output.write(`\n${detail}\n`);
  const answer = await ask(`\n${message} [y/N] `);
  const normalized = answer.toLowerCase();
  return normalized === "y" || normalized === "yes";
}

// Higher-friction gate for push/PR-creation-class actions: a stray keystroke
// must not be able to approve it, so the operator has to type back an exact
// phrase (the branch name for a push, a fixed word for a PR) rather than
// just "y".
export async function confirmDangerous({ message, detail, requireTypedPhrase }) {
  if (detail) output.write(`\n${detail}\n`);
  output.write(`\n${message}\n`);
  const answer = await ask(`Type "${requireTypedPhrase}" to confirm (anything else cancels): `);
  return answer === requireTypedPhrase;
}
