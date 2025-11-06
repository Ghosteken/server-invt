"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpensesByCategory = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
// Use shared Prisma client
const getExpensesByCategory = async (req, res) => {
    try {
        const expenseByCategorySummaryRaw = await prisma_1.default.expenseByCategory.findMany({
            orderBy: {
                date: "desc",
            },
        });
        const expenseByCategorySummary = expenseByCategorySummaryRaw.map((item) => ({
            ...item,
            amount: item.amount.toString(),
        }));
        res.json(expenseByCategorySummary);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving expenses by category" });
    }
};
exports.getExpensesByCategory = getExpensesByCategory;
