// credentialCrypto.js
// At-rest encryption for per-client third-party credentials (OAuth refresh
// tokens, API tokens) stored in directoryRoutes.js's directoryConnections
// collection. Nothing else in ShieldAI stores a reversible secret like this —
// every existing secret is either a global env var (see SECRETS_RUNBOOK.md)
// or a one-way hash we only ever compare against (integrations.tokenHash) —
// so this is a new primitive, not a reuse of an existing helper.
//
// AES-256-GCM via Node's built-in crypto module — no new dependency. The key
// comes from CREDENTIAL_ENCRYPTION_KEY, a NEW env var, deliberately separate
// from JWT_SECRET: JWT_SECRET is a session-signing key whose rotation
// invalidates every logged-in session, which is the wrong operational
// coupling for a credential-encryption key that should be rotatable
// independently.
//
// Unlike auth.js's JWT_SECRET (which throws at module load — appropriate
// since every request needs it), this key is read and validated lazily, on
// first actual use. Directory integrations are a new, currently-unused
// feature; a hard boot-time throw here would take down the entire app
// (login, assessments, everything) on any deploy where this one new env var
// hasn't been set yet in Railway. Failing loudly the first time someone
// actually tries to encrypt/decrypt a credential gives the same "never
// silently insecure" guarantee with a much smaller blast radius.

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";

function loadKey() {
  const b64 = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is not set. Directory integrations cannot store " +
      "credentials without it. Set it in Railway → Variables (or .env locally) — " +
      'generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256, got ${key.length}. ` +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  return key;
}

// Encrypts a plaintext string. Returns a JSON-serializable object
// { ct, iv, tag } (all base64) suitable for storing directly on a
// directoryConnections row.
export function encryptSecret(plaintext) {
  const key = loadKey();
  const iv = randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct: ct.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

// Reverses encryptSecret. Throws if the key is missing/wrong or the
// ciphertext/tag don't match (tampering or wrong key) — GCM authenticates,
// it never silently returns garbage plaintext.
export function decryptSecret({ ct, iv, tag }) {
  const key = loadKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
  return pt.toString("utf8");
}
