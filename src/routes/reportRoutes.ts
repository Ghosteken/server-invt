import { Router } from "express";
import { getSalesReport, getFinancialReport, getPurchasesReport, exportSalesReportExcel, exportPurchasesReportExcel } from "../controllers/reportController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/sales", authenticateToken, getSalesReport);
router.get("/financial", authenticateToken, getFinancialReport);
router.get("/purchases", authenticateToken, getPurchasesReport);
router.get("/sales/export", authenticateToken, exportSalesReportExcel);
router.get("/purchases/export", authenticateToken, exportPurchasesReportExcel);

export default router;
