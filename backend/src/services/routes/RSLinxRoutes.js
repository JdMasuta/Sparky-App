// RSLinxRoutes.js
import express from "express";
import {
  runDiagnostics,
  getTagValue,
  writeTagValue,
  getBatchTagValues,
  writeBatchTags,
  getConnectionStatus,
  reconnectRSLinx,
  validateTagConnection,
  monitorQuantity,
  writeSequence,
  stopMonitoring,
} from "../controllers/RSLinxController.js"; // DDE controller functions

const router = express.Router();

// Basic Tag Operations
router.get("/tags/:tagName", getTagValue);
router.post("/tags/:tagName", writeTagValue);

// Batch Operations
router.post("/batch/read", getBatchTagValues);
router.post("/batch/write", writeBatchTags);

// Connection Management
router.get("/status", getConnectionStatus);
router.post("/reconnect", reconnectRSLinx);
router.get("/validate/:tagName", validateTagConnection);

// Diagnostics
router.get("/diagnostics", runDiagnostics);

// Production Operations
router.get("/monitor/:sessionId", monitorQuantity);
router.post("/monitor/stop", stopMonitoring);
router.post("/sequence", writeSequence);

export default router;
