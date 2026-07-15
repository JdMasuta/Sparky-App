import express from "express";
import {
  getStatus,
  listTags,
  readTags,
  writeTags,
} from "../controllers/plcController.js";

// Raw PLC diagnostics. These are mounted behind admin authentication in
// server.js (Phase 3 adds requireAdmin); until then they are reachable but
// documented as admin-only. Operators use /api/pull/* instead.
const router = express.Router();

router.get("/status", getStatus);
router.get("/tags", listTags);
router.post("/read", readTags);
router.post("/write", writeTags);

export default router;
