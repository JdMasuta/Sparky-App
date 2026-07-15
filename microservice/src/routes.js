import express from "express";
import { TAGS } from "./tags.js";
import { isSim } from "./config.js";

// Build the router around a driver instance. The driver is either the real
// EtherNet/IP driver or the simulator; sim-only routes are mounted only when
// the simulator is active.
export function buildRoutes(driver) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", mode: driver.mode });
  });

  router.get("/status", (req, res) => {
    res.json({ connected: driver.connected, mode: driver.mode });
  });

  // Tag metadata (alias -> real address/type). No PLC access; used by the
  // backend's admin diagnostics panel so the two packages stay decoupled.
  router.get("/meta/tags", (req, res) => {
    res.json({
      tags: Object.entries(TAGS).map(([alias, def]) => ({
        alias,
        name: def.name,
        type: def.type,
      })),
    });
  });

  // Read one or many tags. Body: { tags: ["alias", ...] }
  router.post("/batch/read", async (req, res, next) => {
    try {
      const tags = req.body?.tags;
      if (!Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: "tags must be a non-empty array" });
      }
      const results = await driver.read(tags);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  // Write many tags. Body: { tags: { alias: value, ... } }
  router.post("/batch/write", async (req, res, next) => {
    try {
      const tags = req.body?.tags;
      if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
        return res.status(400).json({ error: "tags must be an object map" });
      }
      const results = await driver.write(tags);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  // Read a single tag alias.
  router.get("/tags/:alias", async (req, res, next) => {
    try {
      const { alias } = req.params;
      const results = await driver.read([alias]);
      res.json({ tag: alias, value: results[alias] });
    } catch (err) {
      next(err);
    }
  });

  // Write a single tag alias. Body: { value }
  router.post("/tags/:alias", async (req, res, next) => {
    try {
      const { alias } = req.params;
      await driver.write({ [alias]: req.body?.value });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // --- Simulator control (only when PLC_MODE=sim) ---
  if (isSim()) {
    router.post("/sim/pull/start", (req, res, next) => {
      try {
        const started = driver.startPull({
          targetQuantity: req.body?.targetQuantity,
          rate: req.body?.rate,
        });
        res.json({ ok: true, ...started });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    router.post("/sim/complete", (req, res) => {
      driver.complete();
      res.json({ ok: true });
    });

    router.post("/sim/reset", (req, res) => {
      driver.resetSim();
      res.json({ ok: true });
    });

    router.get("/sim/state", (req, res) => {
      res.json(driver.state());
    });
  }

  return router;
}
