import express from "express";
import { getUsers, createUser, purgeNonAdminUsers, deleteUser, blockUser, unblockUser } from "../controllers/userController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = express.Router();

// Protected route - only admins can access
router.get("/", authenticateToken, requireAdmin, getUsers);
router.post("/", authenticateToken, requireAdmin, createUser);
router.delete("/purge", authenticateToken, requireAdmin, purgeNonAdminUsers);
router.delete("/:userId", authenticateToken, requireAdmin, deleteUser);
router.patch("/:userId/block", authenticateToken, requireAdmin, blockUser);
router.patch("/:userId/unblock", authenticateToken, requireAdmin, unblockUser);

export default router;
