// LAN-facing proxy (#25). Deliberately dumb (SECURITY.md): it holds no
// secrets, no docker.sock and no data, parses no request bodies, and only
// streams HTTP to the app container named in /route/active.json. Besides that
// it serves the sanitized update status at GET /__edge/status, which the Admin
// page polls while the app itself is down mid-handover.
import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// Hop-by-hop headers (RFC 9110 §7.6.1) plus forwarding headers we set ourselves.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const FORWARDING = new Set(["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]);

/** Copy headers minus hop-by-hop ones (and any the Connection header names). */
export function stripHopByHop(headers, { dropForwarding = false } = {}) {
  const named = new Set(
    String(headers.connection || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || named.has(k)) continue;
    if (dropForwarding && FORWARDING.has(k)) continue;
    out[k] = value;
  }
  return out;
}

/** Client address without the IPv4-mapped IPv6 prefix. */
export const clientAddress = (socket) => String(socket.remoteAddress || "").replace(/^::ffff:/, "");

const UPDATING_MESSAGE = "Sparky is restarting for an update. Please retry in a moment.";
const UPDATING_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>Sparky is updating</title><style>body{font-family:system-ui,sans-serif;margin:15vh auto;max-width:32rem;
text-align:center;color:#334155}</style></head><body><h1>Sparky is updating</h1>
<p>${UPDATING_MESSAGE}</p><p>This page reloads automatically.</p></body></html>`;

function sendUpdating(req, res) {
  const wantsJson = req.url.startsWith("/api/") || String(req.headers.accept || "").includes("application/json");
  res.writeHead(503, {
    "Content-Type": wantsJson ? "application/json" : "text/html; charset=utf-8",
    "Retry-After": "5",
    "Cache-Control": "no-store",
  });
  res.end(wantsJson ? JSON.stringify({ error: UPDATING_MESSAGE, updating: true }) : UPDATING_HTML);
}

/** Reads a small JSON file, re-reading only when its mtime changes. */
function cachedJson(file) {
  let mtime = -1;
  let value = null;
  return () => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== mtime) {
        value = JSON.parse(readFileSync(file, "utf8"));
        mtime = m;
      }
    } catch {
      mtime = -1;
      value = null;
    }
    return value;
  };
}

/**
 * @param {object} o
 * @param {string} o.routeDir directory holding active.json and status.json
 * @param {(msg: string) => void} [o.log]
 * @returns {http.Server}
 */
export function createProxy({ routeDir, log = () => {} }) {
  const activeRoute = cachedJson(path.join(routeDir, "active.json"));
  const statusFile = path.join(routeDir, "status.json");

  const server = http.createServer((req, res) => {
    // Edge endpoints are answered here and never forwarded.
    if (req.url === "/__edge" || req.url.startsWith("/__edge/") || req.url.startsWith("/__edge?")) {
      const pathname = req.url.split("?")[0];
      if (pathname !== "/__edge/status") {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Not found" }));
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Method not allowed" }));
      }
      let body;
      try {
        body = readFileSync(statusFile, "utf8");
      } catch {
        body = JSON.stringify({ phase: "unknown" });
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : body);
    }

    const route = activeRoute();
    if (!route?.name || !route?.port) return sendUpdating(req, res);

    const headers = stripHopByHop(req.headers, { dropForwarding: true });
    // Overwrite (never append): clients cannot spoof their rate-limit key.
    headers["x-forwarded-for"] = clientAddress(req.socket);
    headers["x-forwarded-proto"] = "http";
    if (req.headers.host) headers["x-forwarded-host"] = req.headers.host;

    const upstream = http.request(
      { host: route.name, port: route.port, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode, upRes.statusMessage, stripHopByHop(upRes.headers));
        upRes.pipe(res);
        upRes.on("error", () => res.destroy());
      },
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) {
        log(`upstream ${route.name}:${route.port} unavailable: ${err.code || err.message}`);
        sendUpdating(req, res);
      } else {
        res.destroy();
      }
    });
    // Client went away (e.g. Checkout page closed mid long-poll): drop upstream.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });

  // Checkout monitor long-polls legitimately last up to 10 minutes.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
