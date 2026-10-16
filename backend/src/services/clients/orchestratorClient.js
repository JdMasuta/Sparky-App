// Thin HTTP client from the backend to the update orchestrator (container
// deployment, #25). The orchestrator listens only on the internal control
// network and accepts only this container's token (SPARKY_ORCH_TOKEN), so the
// browser never reaches it; admin auth is enforced here, before any call.
// Env is read per call: SPARKY_ORCH_URL is set only in the container deployment.

/** True in the container deployment (the orchestrator injects SPARKY_ORCH_URL). */
export const isContainerDeployment = () => !!process.env.SPARKY_ORCH_URL;

async function orchFetch(path, { method = "GET", timeoutMs = 15000 } = {}) {
  const base = process.env.SPARKY_ORCH_URL;
  const token = process.env.SPARKY_ORCH_TOKEN || "";
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // Network failure or timeout: the orchestrator itself is unreachable.
    const err = new Error("Update service is unreachable");
    err.status = null;
    err.cause = cause;
    throw err;
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = new Error(json?.error || `Update service HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const orchestrator = {
  /** Current vs latest release, update window and update status. */
  check: () => orchFetch("/v1/check", { timeoutMs: 30000 }),
  /** Queue the latest release; it runs inside the update window. */
  queueUpdate: () => orchFetch("/v1/update", { method: "POST", timeoutMs: 30000 }),
  /** Cancel a queued update (until the handover commits). */
  cancelUpdate: () => orchFetch("/v1/update", { method: "DELETE" }),
};
