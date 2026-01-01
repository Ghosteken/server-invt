"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiController_1 = require("../controllers/aiController");
const router = (0, express_1.Router)();
router.post("/purchasing-advisor", aiController_1.getPurchasingAdvisorAnalysis);
exports.default = router;
