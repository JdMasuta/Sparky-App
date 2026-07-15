// Password hashing (scrypt) and signed session tokens (HMAC), using only
// node:crypto — no external auth dependencies.
import crypto from "crypto";

// ---- password hashing ------------------------------------------------------
const SCRYPT_KEYLEN = 64;

/** Hash a plaintext password. Format: "scrypt$<saltHex>$<hashHex>". */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verify a plaintext password against a stored "scrypt$salt$hash" string. */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, expected.length);
  } catch {
    return false;
  }
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

// ---- signed session tokens -------------------------------------------------
// A stateless token: base64url(payload) "." base64url(HMAC-SHA256(payload)).
// No server-side session store needed.
const b64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(dataB64, secret) {
  return crypto.createHmac("sha256", secret).update(dataB64).digest("base64url");
}

export function createToken(payload, secret, ttlMs) {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const dataB64 = b64url(JSON.stringify(body));
  return `${dataB64}.${sign(dataB64, secret)}`;
}

/** Verify a token; returns the payload if valid & unexpired, else null. */
export function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const dataB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(dataB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
