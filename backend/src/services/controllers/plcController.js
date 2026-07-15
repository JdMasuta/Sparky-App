// Raw PLC diagnostics — direct tag read/write via the bridge. These are
// admin-only (see plcRoutes/Phase 3): they let an administrator inspect or
// poke individual tags for troubleshooting. Normal operators never hit these.
import { plcBridge } from "../clients/plcBridgeClient.js";

// GET /api/plc/status
export const getStatus = async (req, res) => {
  res.status(200).json(await plcBridge.status());
};

// GET /api/plc/tags -> list known aliases (safe metadata, proxied from bridge)
export const listTags = async (req, res) => {
  try {
    res.status(200).json({ tags: await plcBridge.metaTags() });
  } catch (err) {
    res.status(502).json({ error: "Bridge unavailable", message: err.message });
  }
};

// POST /api/plc/read  { tags: ["alias", ...] }
export const readTags = async (req, res) => {
  const tags = req.body?.tags;
  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: "tags must be a non-empty array" });
  }
  try {
    res.status(200).json({ results: await plcBridge.read(tags) });
  } catch (err) {
    res.status(502).json({ error: "PLC read failed", message: err.message });
  }
};

// POST /api/plc/write  { tags: { alias: value, ... } }
export const writeTags = async (req, res) => {
  const tags = req.body?.tags;
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    return res.status(400).json({ error: "tags must be an object map" });
  }
  try {
    res.status(200).json({ results: await plcBridge.write(tags) });
  } catch (err) {
    res.status(502).json({ error: "PLC write failed", message: err.message });
  }
};
