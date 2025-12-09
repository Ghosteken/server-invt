import { Router } from "express";
import { createSalesAgent, getAgentInvoices, getSalesAgents, updateSalesAgent, deleteSalesAgent } from "../controllers/salesAgentController";

const router = Router();

router.get("/", getSalesAgents);
router.post("/", createSalesAgent);
router.get("/:id/invoices", getAgentInvoices);
router.put("/:id", updateSalesAgent);
router.delete("/:id", deleteSalesAgent);

export default router;
