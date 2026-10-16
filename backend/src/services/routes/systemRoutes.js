import express from "express";
import {
  getInfo,
  triggerUpdate,
  getUpdateCheck,
  cancelUpdate,
} from "../controllers/systemController.js";

// Admin-only (mounted behind requireAdmin in server.js).
const router = express.Router();

router.get("/info", getInfo);
router.get("/update/check", getUpdateCheck);
router.post("/update", triggerUpdate);
router.delete("/update", cancelUpdate);

export default router;
