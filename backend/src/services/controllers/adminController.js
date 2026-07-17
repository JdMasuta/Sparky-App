// Aggregated data for the admin Overview tab — one request instead of seven.
import { getDatabase, getMigrationWarnings } from "../../init/db.init.js";
import { plcBridge } from "../clients/plcBridgeClient.js";

const COUNT_TABLES = ["users", "projects", "items", "checkouts"];

// GET /api/admin/overview
export const getOverview = async (req, res) => {
  try {
    const db = getDatabase();

    const counts = {};
    for (const table of COUNT_TABLES) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    }

    const lastReport =
      db
        .prepare(
          "SELECT * FROM weekly_report_status ORDER BY ran_at DESC LIMIT 1",
        )
        .get() ?? null;

    // status() never throws — reports { connected: false, mode: "unknown" }.
    const plc = await plcBridge.status();

    res.status(200).json({
      counts,
      plc,
      lastReport,
      warnings: getMigrationWarnings(),
    });
  } catch (error) {
    console.error("Error building admin overview:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
