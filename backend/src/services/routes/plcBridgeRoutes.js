// backend/src/services/routes/plcBridgeRoutes.js
import express from "express";
import {
  AUTH_TOKEN,
  getTag,
  postTag,
  batchRead,
  batchWrite,
  getStatus,
  monitor,
  stopMonitor,
} from "../controllers/plcBridgeController.js";

const router = express.Router();

// Authentication middleware
function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  // Toggle authentication check as needed
  if (false && authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Basic Tag Operations
router.get("/tags/:tagName", verifyAuth, getTag);
router.post("/tags/:tagName", verifyAuth, postTag);

// Batch Operations
router.post("/batch/read", verifyAuth, batchRead);
router.post("/batch/write", verifyAuth, batchWrite);

// Connection Management
router.get("/status", verifyAuth, getStatus);
// router.post("/reconnect", verifyAuth, reconnect);

// Production Operations: Monitoring the PLC
router.get("/monitor/:sessionId", verifyAuth, monitor);
router.post("/monitor/stop", verifyAuth, stopMonitor);

// // WebSocket Endpoint
// router.ws("/ws", wsHandler);

export default router;
