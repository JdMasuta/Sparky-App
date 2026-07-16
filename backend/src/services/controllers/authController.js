// Admin authentication endpoints. Server-side sessions via a signed, httpOnly,
// SameSite=Strict cookie (no server-side session store). Replaces the old
// client-only PIN gate.
import { securityConfig } from "../config/server.config.js";
import { verifyPassword, createToken } from "../auth/crypto.js";
import { getSession } from "../middleware/requireAdmin.js";

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict",
  // The edge device serves the app over plain HTTP on the LAN, so the cookie
  // cannot be Secure-only or it would never be sent. SameSite=Strict + httpOnly
  // provide the protection. (Front the app with TLS if exposed beyond the LAN.)
  secure: false,
  path: "/",
  maxAge: securityConfig.sessionTtlMs,
});

// POST /api/auth/login  { password }
export const login = (req, res) => {
  const { password } = req.body ?? {};
  if (!securityConfig.adminPasswordHash) {
    return res.status(503).json({
      error:
        "Admin password not configured. Run backend/scripts/hash-password.js and set ADMIN_PASSWORD_HASH.",
    });
  }
  if (!password || !verifyPassword(password, securityConfig.adminPasswordHash)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = createToken(
    { sub: "admin" },
    securityConfig.sessionSecret,
    securityConfig.sessionTtlMs
  );
  res.cookie(securityConfig.cookieName, token, cookieOptions());
  res.status(200).json({ success: true });
};

// POST /api/auth/logout
export const logout = (req, res) => {
  res.clearCookie(securityConfig.cookieName, { path: "/" });
  res.status(200).json({ success: true });
};

// GET /api/auth/session -> { authenticated: boolean }
export const session = (req, res) => {
  res.status(200).json({ authenticated: !!getSession(req) });
};
