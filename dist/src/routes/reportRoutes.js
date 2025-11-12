"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reportController_1 = require("../controllers/reportController");
const router = (0, express_1.Router)();
router.get("/sales", reportController_1.getSalesReport);
router.get("/financial", reportController_1.getFinancialReport);
router.get("/purchases", reportController_1.getPurchasesReport);
exports.default = router;
