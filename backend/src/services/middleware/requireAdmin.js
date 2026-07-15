// Gate for admin-only routes. Verifies the signed session cookie and, for
// state-changing methods, enforces the custom CSRF header. Reads a fresh copy
// of securityConfig via import so tests can set env before importing.
import { securityConfig } from "../config/server.config.js";
import { verifyToken } from "../auth/crypto.js";

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[securityConfig.cookieName];
  return verifyToken(token, securityConfig.sessionSecret);
}

export function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }
  // CSRF: mutations must carry the custom header. With a SameSite=Strict cookie
  // this blocks cross-site form/fetch abuse of the admin session.
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (mutating) {
    const provided = req.get(securityConfig.csrfHeader);
    if (provided !== securityConfig.csrfValue) {
      return res.status(403).json({ error: "Missing or invalid CSRF header" });
    }
  }
  req.admin = session;
  next();
}
