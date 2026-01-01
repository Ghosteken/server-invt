import { Router } from "express";
import { getPurchasingAdvisorAnalysis } from "../controllers/aiController";

const router = Router();

router.post("/purchasing-advisor", getPurchasingAdvisorAnalysis);

export default router;
