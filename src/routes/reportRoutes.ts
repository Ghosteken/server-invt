import { Router } from "express";
import { getSalesReport } from "../controllers/reportController";

const router = Router();

router.get("/sales", getSalesReport);

export default router;