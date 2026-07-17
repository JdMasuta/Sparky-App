import express from "express";
import { getOverview } from "../controllers/adminController.js";

// Admin-only (mounted behind requireAdmin in server.js).
const router = express.Router();

router.get("/overview", getOverview);

export default router;
