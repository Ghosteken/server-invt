import express from "express";
import { login, signup, verifyToken } from "../controllers/authController";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/verify", verifyToken);

export default router;