"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPurchasingAdvisorAnalysis = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const aiService_1 = require("../services/aiService");
const getPurchasingAdvisorAnalysis = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const { mode, query } = req.body;
        // Validate mode
        const validModes = ["general", "restock", "dead_stock", "customer_insight", "profit_optimization", "chat"];
        const safeMode = validModes.includes(mode) ? mode : "general";
        const result = await (0, aiService_1.getPurchasingAdvice)(prisma_1.default, tenantId, safeMode, query);
        res.json(result);
    }
    catch (error) {
        console.error("Error generating purchasing advice:", error);
        res.status(500).json({ message: "Failed to generate AI analysis" });
    }
};
exports.getPurchasingAdvisorAnalysis = getPurchasingAdvisorAnalysis;
