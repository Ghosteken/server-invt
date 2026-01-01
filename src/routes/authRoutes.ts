import express from "express";
import { login, verifyToken, orgAdminLogin, signupOrg } from "../controllers/authController";

const router = express.Router();

router.post("/login", login);
router.post("/signup-org", signupOrg);
router.post("/org-admin/login", orgAdminLogin);
router.get("/verify", verifyToken);

export default router;
