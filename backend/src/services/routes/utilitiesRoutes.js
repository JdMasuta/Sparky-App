// backend/src/services/routes/utilitiesRoutes.js
import express from "express";
import {
  gitPull,
  gitStatus,
  pyExecute,
  pwshExecute,
} from "../controllers/utilitiesController.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// API endpoints for utilities
router.post("/git/pull", authenticate, gitPull);
router.get("/git/status", authenticate, gitStatus);
router.post("/exe/python", authenticate, pyExecute);
router.post("/exe/pwsh", authenticate, pwshExecute);

export default router;
