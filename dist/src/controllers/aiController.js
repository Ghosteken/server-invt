"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenseAnomalies = exports.getPurchasingAdvisorAnalysis = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const aiService_1 = require("../services/aiService");
const errorHandler_1 = require("../utils/errorHandler");
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
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to generate AI analysis"));
    }
};
exports.getPurchasingAdvisorAnalysis = getPurchasingAdvisorAnalysis;
const getExpenseAnomalies = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        // Fetch all expenses
        const expenses = await prisma_1.default.expenses.findMany({
            where: { tenantId },
            orderBy: { timestamp: "desc" }
        });
        const anomalies = [];
        const recurring = [];
        // Group by category for anomaly detection
        const byCategory = {};
        for (const e of expenses) {
            const cat = e.category || "Uncategorized";
            if (!byCategory[cat])
                byCategory[cat] = [];
            byCategory[cat].push(e);
        }
        // Detect Anomalies (Statistical Outliers)
        for (const [cat, items] of Object.entries(byCategory)) {
            if (items.length < 3)
                continue; // Need minimum data points
            const amounts = items.map(i => Number(i.amount));
            const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
            const stdDev = Math.sqrt(variance);
            // Flag if > 2 stdDev from mean and significantly higher than mean
            for (const item of items) {
                if (Number(item.amount) > mean + (2 * stdDev)) {
                    anomalies.push({
                        ...item,
                        reason: `Unusually high amount for ${cat} (Mean: ${mean.toFixed(2)})`,
                        confidence: "High"
                    });
                }
            }
        }
        // Detect Continuous/Recurring Expenses
        // Look for identical amounts within similar time intervals or just frequent same-amount items
        const byAmount = {};
        for (const e of expenses) {
            const key = `${e.amount}-${e.category}`;
            if (!byAmount[key])
                byAmount[key] = [];
            byAmount[key].push(e);
        }
        for (const [key, items] of Object.entries(byAmount)) {
            if (items.length >= 3) {
                // Sort by date desc
                items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
                // Check for regularity? For now, just flagging frequent identical expenses is a good start for "continuous"
                recurring.push({
                    groupKey: key,
                    count: items.length,
                    category: items[0].category,
                    amount: items[0].amount,
                    lastOccurred: items[0].timestamp,
                    examples: items.slice(0, 5)
                });
            }
        }
        res.json({ anomalies, recurring });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to detect anomalies"));
    }
};
exports.getExpenseAnomalies = getExpenseAnomalies;
