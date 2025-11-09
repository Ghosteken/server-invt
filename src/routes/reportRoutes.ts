import { Router } from "express";
import { getSalesReport, getFinancialReport, getPurchasesReport } from "../controllers/reportController";

const router = Router();

router.get("/sales", getSalesReport);
router.get("/financial", getFinancialReport);
router.get("/purchases", getPurchasesReport);

export default router;