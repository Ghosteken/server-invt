import { Router } from "express";
import { getPurchasingAdvisorAnalysis, getExpenseAnomalies } from "../controllers/aiController";

const router = Router();

router.post("/purchasing-advisor", getPurchasingAdvisorAnalysis);
router.get("/expense-anomalies", getExpenseAnomalies);

export default router;
