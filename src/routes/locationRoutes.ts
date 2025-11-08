import { Router } from "express";
import { createLocation, getLocations } from "../controllers/locationController";

const router = Router();

router.get("/", getLocations);
router.post("/", createLocation);

export default router;