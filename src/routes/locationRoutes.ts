import { Router } from "express";
import { createLocation, getLocations, updateLocation, deleteLocation } from "../controllers/locationController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get("/", authenticateToken, getLocations);
router.post("/", authenticateToken, requirePermission("locations", "create"), requireAdmin, createLocation);
router.put("/:id", authenticateToken, requirePermission("locations", "update"), requireAdmin, updateLocation);
router.delete("/:id", authenticateToken, requirePermission("locations", "delete"), requireAdmin, deleteLocation);

export default router;
