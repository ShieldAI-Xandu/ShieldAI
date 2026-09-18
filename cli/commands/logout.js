// cli/commands/logout.js

import { clearSession } from "../lib/session.js";

export async function runLogout() {
  clearSession();
  console.log("Logged out. (Your GitHub token, if any, is untouched — run `shieldai github logout` to remove it too.)");
}
