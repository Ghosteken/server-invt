import { Router } from "express";
import { getPermissions, updatePermissions } from "../controllers/permissionController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/:userId", authenticateToken, getPermissions);
router.put("/:userId", authenticateToken, updatePermissions);

export default router;
