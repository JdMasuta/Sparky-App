import express from "express";
import { securityConfig } from "../config/server.config.js";

const router = express.Router();

router.post("/verify-pin", (req, res) => {
  const { pin } = req.body;
  if (pin === securityConfig.configPin) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Invalid PIN" });
  }
});

export default router;
