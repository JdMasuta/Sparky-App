// backend/src/services/routes/utilitiesRoutes.js
import express from "express";
import { gitPull, gitStatus } from "../controllers/utilitiesController.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// API endpoints for utilities
router.post("/git/pull", authenticate, gitPull);
router.get("/git/status", authenticate, gitStatus);

export default router;
