import express from "express";
import { login, verifyToken, adminLogin } from "../controllers/authController";

const router = express.Router();

router.post("/login", login);
router.post("/admin/login", adminLogin);
router.get("/verify", verifyToken);

export default router;