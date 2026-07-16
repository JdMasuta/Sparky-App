import express from "express";
import { getInfo, triggerUpdate } from "../controllers/systemController.js";

// Admin-only (mounted behind requireAdmin in server.js).
const router = express.Router();

router.get("/info", getInfo);
router.post("/update", triggerUpdate);

export default router;
