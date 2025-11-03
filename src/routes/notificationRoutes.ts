import express from "express";
import { getNotifications } from "../controllers/notificationController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", authenticateToken, getNotifications);

export default router;