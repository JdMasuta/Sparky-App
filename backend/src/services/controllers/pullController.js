// Intent-based Checkout gateway. The browser sends high-level intents (set the
// operator/project/item field, monitor the pull, reset) and the backend
// validates each against the database before performing the corresponding
// whitelisted PLC tag writes via the loopback bridge. The browser can no longer
// write arbitrary PLC tags.
import { getDatabase } from "../../init/db.init.js";
import { plcBridge } from "../clients/plcBridgeClient.js";

// Checkout field -> (PLC string tag alias, handshake step, DB existence check).
const FIELDS = {
  user: {
    tag: "userName",
    step: 2,
    exists: (db, v) =>
      db
        .prepare(
          "SELECT 1 FROM users WHERE name = ? COLLATE NOCASE AND COALESCE(status,'ACTIVE') = 'ACTIVE'"
        )
        .get(v),
    missing: "Unknown or inactive user",
  },
  project: {
    tag: "moNumber",
    step: 3,
    exists: (db, v) =>
      db
        .prepare(
          "SELECT 1 FROM projects WHERE project_number = ? COLLATE NOCASE AND COALESCE(status,'ACTIVE') = 'ACTIVE'"
        )
        .get(v),
    missing: "Unknown or inactive project",
  },
  item: {
    tag: "itemNumber",
    step: 4,
    exists: (db, v) => db.prepare("SELECT 1 FROM items WHERE sku = ? COLLATE NOCASE").get(v),
    missing: "Unknown item SKU",
  },
};

// GET /api/pull/status -> { connected, mode }
export const getPullStatus = async (req, res) => {
  const status = await plcBridge.status();
  res.status(200).json(status);
};

// POST /api/pull/field  { field, value }
export const setPullField = async (req, res) => {
  const { field, value } = req.body ?? {};
  const spec = FIELDS[field];
  if (!spec) {
    return res.status(400).json({ error: "Unknown field", field: "field" });
  }
  const v = typeof value === "string" ? value.trim() : value;
  if (!v) {
    return res.status(422).json({ error: "Value is required", field });
  }

  try {
    const db = getDatabase();
    if (!spec.exists(db, v)) {
      return res.status(422).json({ error: spec.missing, field });
    }
    // Write the operator-facing string tag and advance the handshake step.
    await plcBridge.write({ [spec.tag]: v, stepNumber: spec.step });
    res.status(200).json({ ok: true, step: spec.step });
  } catch (err) {
    console.error("setPullField error:", err.message);
    res.status(502).json({ error: "PLC write failed", message: err.message });
  }
};

// POST /api/pull/reset  -> resets the handshake to idle (step 1)
export const resetPull = async (req, res) => {
  try {
    await plcBridge.write({ stepNumber: 1 });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("resetPull error:", err.message);
    res.status(502).json({ error: "PLC reset failed", message: err.message });
  }
};

// GET /api/pull/backup-quantity -> reads the backup encoder value
export const getBackupQuantity = async (req, res) => {
  try {
    const results = await plcBridge.read(["backupQuantity"]);
    res.status(200).json({ value: results.backupQuantity });
  } catch (err) {
    console.error("getBackupQuantity error:", err.message);
    res.status(502).json({ error: "PLC read failed", message: err.message });
  }
};

// ---- monitor sessions (long-poll) -----------------------------------------
// Kept server-side (as before) so the browser sees a single blocking request
// that resolves with the final encoder quantity. The backend polls the bridge.
const monitoringSessions = new Map(); // sessionId -> { aborted: boolean }

// GET /api/pull/monitor/:sessionId?threshold=&timeout=&pollInterval=
export const monitorPull = async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

  const pollInterval = clampInt(req.query.pollInterval, 500, 100, 5000);
  const timeout = clampInt(req.query.timeout, 600000, 1000, 3600000);
  const threshold = Number(req.query.quantityThreshold ?? req.query.threshold ?? 0) || 0;

  const session = { aborted: false };
  monitoringSessions.set(sessionId, session);

  const startedAt = Date.now();
  let quantity = 0;
  let completeRequest = false;

  try {
    while (Date.now() - startedAt < timeout) {
      if (session.aborted) {
        monitoringSessions.delete(sessionId);
        return res.status(200).json({
          success: false,
          aborted: true,
          finalQuantity: quantity,
          timeElapsed: Date.now() - startedAt,
        });
      }

      const results = await plcBridge.read(["completeRequest", "quantity"]);
      completeRequest = results.completeRequest === true;
      quantity = Number(results.quantity) || 0;

      if (completeRequest && (threshold === 0 || quantity >= threshold)) {
        monitoringSessions.delete(sessionId);
        return res.status(200).json({
          success: true,
          finalQuantity: quantity,
          finalCompleteRequest: true,
          timeElapsed: Date.now() - startedAt,
        });
      }

      await sleep(pollInterval);
    }

    monitoringSessions.delete(sessionId);
    res.status(200).json({
      success: false,
      timedOut: true,
      finalQuantity: quantity,
      timeElapsed: Date.now() - startedAt,
    });
  } catch (err) {
    monitoringSessions.delete(sessionId);
    console.error("monitorPull error:", err.message);
    res.status(502).json({ success: false, error: "PLC monitor failed", message: err.message });
  }
};

// POST /api/pull/monitor/stop  { sessionId }
export const stopMonitor = (req, res) => {
  const { sessionId } = req.body ?? {};
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  const session = monitoringSessions.get(sessionId);
  if (session) session.aborted = true;
  monitoringSessions.delete(sessionId);
  // Always report success so the client can clear its state (idempotent).
  res.status(200).json({ success: true });
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function clampInt(raw, dflt, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}
