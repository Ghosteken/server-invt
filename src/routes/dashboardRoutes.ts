import { Router } from "express";
import { getDashboardMetrics, getLowStockProducts, getExpiringProducts, getDeadStockProducts, getTopCustomers } from "../controllers/dashboardController";

const router = Router();

router.get("/", getDashboardMetrics);
router.get("/low-stock", getLowStockProducts);
router.get("/expiring", getExpiringProducts);
router.get("/dead-stock", getDeadStockProducts);
router.get("/top-customers", getTopCustomers);

export default router;
