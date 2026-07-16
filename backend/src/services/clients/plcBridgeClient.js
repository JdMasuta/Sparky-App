// Thin HTTP client from the backend to the PLC bridge microservice (loopback).
// The browser never talks to the bridge directly — only this client does, and
// only after the backend has validated the request.
const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT || 8000);
const TOKEN = process.env.BRIDGE_TOKEN || "";
const BASE = `http://${HOST}:${PORT}`;

async function bridgeFetch(path, { method = "GET", body, timeoutMs = 8000 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["X-Bridge-Token"] = TOKEN;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = new Error(json?.message || json?.error || `Bridge HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const plcBridge = {
  async status() {
    // Never throw for a status probe — report disconnected instead.
    try {
      return await bridgeFetch("/status", { timeoutMs: 3000 });
    } catch {
      return { connected: false, mode: "unknown" };
    }
  },

  /** @param {string[]} aliases -> { alias: value } */
  async read(aliases) {
    const json = await bridgeFetch("/batch/read", {
      method: "POST",
      body: { tags: aliases },
    });
    return json.results;
  },

  /** @param {Record<string, any>} values alias -> value */
  async write(values) {
    const json = await bridgeFetch("/batch/write", {
      method: "POST",
      body: { tags: values },
    });
    return json.results;
  },

  /** Tag metadata (alias/name/type) for the admin diagnostics panel. */
  async metaTags() {
    const json = await bridgeFetch("/meta/tags", { timeoutMs: 3000 });
    return json.tags;
  },
};
