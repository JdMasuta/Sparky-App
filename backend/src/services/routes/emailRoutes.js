import express from "express";
import {
  testEmailConfig,
  sendCheckoutReport,
  sendCheckoutReportToAll,
} from "../controllers/emailController.js";

const router = express.Router();

router.post("/email-report", sendCheckoutReport);
router.post("/email-report-all", sendCheckoutReportToAll);
router.post("/test-email", testEmailConfig);

export default router;
