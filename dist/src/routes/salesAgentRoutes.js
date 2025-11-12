"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const salesAgentController_1 = require("../controllers/salesAgentController");
const router = (0, express_1.Router)();
router.get("/", salesAgentController_1.getSalesAgents);
router.post("/", salesAgentController_1.createSalesAgent);
router.get("/:id/invoices", salesAgentController_1.getAgentInvoices);
exports.default = router;
