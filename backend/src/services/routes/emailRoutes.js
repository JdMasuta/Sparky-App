import express from "express";
import {
  testEmailConfig,
  sendCheckoutReport,
} from "../controllers/emailController.js";

const router = express.Router();

router.post("/email-report", sendCheckoutReport);
router.post("/test-email", testEmailConfig);

export default router;
