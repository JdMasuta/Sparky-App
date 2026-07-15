import express from "express";
import {
  getPullStatus,
  setPullField,
  resetPull,
  getBackupQuantity,
  monitorPull,
  stopMonitor,
} from "../controllers/pullController.js";

// Intent-based Checkout endpoints. Open to floor operators (no admin login),
// but every write is validated against the DB server-side and only whitelisted
// tags are written — the browser cannot address arbitrary PLC tags.
const router = express.Router();

router.get("/status", getPullStatus);
router.post("/field", setPullField);
router.post("/reset", resetPull);
router.get("/backup-quantity", getBackupQuantity);
router.get("/monitor/:sessionId", monitorPull);
router.post("/monitor/stop", stopMonitor);

export default router;
