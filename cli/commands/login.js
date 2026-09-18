// cli/commands/login.js

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SERVER_URL } from "../lib/config.js";
import { saveSession } from "../lib/session.js";

// Hand-rolled masked input via raw stdin mode — avoids pulling in a prompts
// library for the one place that needs it. On a non-TTY stdin (piped input,
// some CI shells) this falls back to the SAME readline interface used for
// the email prompt instead of masked capture — creating/closing a second
// readline interface on the same stdin stream is unreliable when stdin is a
// pipe. On a real TTY, the caller must close that readline interface first
// (this function attaches its own raw 'data' listener directly to stdin,
// which would double-handle keystrokes if readline were still attached).
function promptPassword(rl, question) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    output.write("(warning: this terminal can't mask input — password will be visible)\n");
    return rl.question(question).then(v => v.trim());
  }
  return new Promise((resolve) => {
    output.write(question);
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        cleanup();
        output.write("\n");
        resolve(value);
      } else if (char === "") {
        cleanup();
        output.write("\n");
        process.exit(1);
      } else if (char === "" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    function cleanup() {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    }
    input.on("data", onData);
  });
}

export async function runLogin() {
  const rl = readline.createInterface({ input, output });
  const isTty = input.isTTY && typeof input.setRawMode === "function";
  let email, password;
  try {
    email = (await rl.question("ShieldAI email: ")).trim();
    if (isTty) {
      // Masked capture attaches its own raw listener to stdin — close
      // readline's first so the two don't both consume keystrokes.
      rl.close();
      password = await promptPassword(rl, "Password: ");
    } else {
      password = await promptPassword(rl, "Password: ");
    }
  } finally {
    rl.close();
  }

  let res;
  try {
    res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    console.error(`Could not reach ${SERVER_URL}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Login failed: ${data.error || res.statusText}`);
    process.exitCode = 1;
    return;
  }
  if (!data.user?.isAdmin) {
    console.error("This CLI is for ShieldAI admin-category and super-admin staff only.");
    process.exitCode = 1;
    return;
  }

  saveSession({ token: data.token, email: data.user.email });
  console.log(`Logged in as ${data.user.email} (${data.user.category}).`);
}
