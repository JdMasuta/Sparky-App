import { config } from "./config.js";

// Requires the shared bridge token on every request (except /health) when a
// token is configured. This is defense-in-depth on top of the loopback bind —
// even if something on localhost tries to reach the bridge, it needs the token
// the backend shares via env. Empty token disables the check (dev convenience).
export function bridgeAuth(req, res, next) {
  if (!config.token) return next();
  if (req.path === "/health") return next();
  const provided = req.get("x-bridge-token");
  if (provided && provided === config.token) return next();
  return res.status(401).json({ error: "Invalid or missing bridge token" });
}
