import express from "express";
import { login, logout, session } from "../controllers/authController.js";

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", session);

export default router;
