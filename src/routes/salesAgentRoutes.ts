import { Router } from "express";
import { createSalesAgent, getAgentInvoices, getSalesAgents } from "../controllers/salesAgentController";

const router = Router();

router.get("/", getSalesAgents);
router.post("/", createSalesAgent);
router.get("/:id/invoices", getAgentInvoices);

export default router;