import { Router } from "express";
import { getSalesReport, getFinancialReport, getPurchasesReport } from "../controllers/reportController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/sales", authenticateToken, getSalesReport);
router.get("/financial", authenticateToken, getFinancialReport);
router.get("/purchases", authenticateToken, getPurchasesReport);

export default router;
