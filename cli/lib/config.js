// cli/lib/config.js
// Server + local config-dir resolution. The CLI never reads .env or imports
// db.js — it's a plain HTTPS client of the deployed (or local dev) server,
// run from an admin's own machine.

import os from "node:os";
import path from "node:path";

export const SERVER_URL = (process.env.SHIELDAI_CLI_SERVER_URL || "http://localhost:3001").replace(/\/+$/, "");

export const CONFIG_DIR = path.join(os.homedir(), ".shieldai-cli");
export const SESSION_FILE = path.join(CONFIG_DIR, "session.json");
export const GITHUB_TOKEN_FILE = path.join(CONFIG_DIR, "github-token");
