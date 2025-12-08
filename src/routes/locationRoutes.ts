import { Router } from "express";
import { createLocation, getLocations, updateLocation, deleteLocation } from "../controllers/locationController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getLocations);
router.post("/", authenticateToken, requireAdmin, createLocation);
router.put("/:id", authenticateToken, requireAdmin, updateLocation);
router.delete("/:id", authenticateToken, requireAdmin, deleteLocation);

export default router;
