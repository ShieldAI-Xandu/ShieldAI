// cli/commands/whoami.js
// Always calls the live server — never prints from the cached session file
// alone — so this doubles as a quick check that the session is still good.

import { getLiveSession, SessionError } from "../lib/session.js";

export async function runWhoami() {
  try {
    const { user } = await getLiveSession();
    console.log(`${user.email} — category: ${user.category}, admin: ${user.isAdmin}, superAdmin: ${user.isSuperAdmin}`);
  } catch (err) {
    if (err instanceof SessionError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
