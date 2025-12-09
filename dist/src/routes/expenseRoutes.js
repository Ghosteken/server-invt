"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const expenseController_1 = require("../controllers/expenseController");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.get("/", expenseController_1.getExpensesByCategory);
router.get("/list", expenseController_1.listExpenses);
router.get("/categories", expenseController_1.getExpenseCategories);
router.post("/categories", expenseController_1.createExpenseCategory);
router.post("/", expenseController_1.createExpense);
router.put("/:id", expenseController_1.updateExpenseController);
router.delete("/:id", expenseController_1.deleteExpenseController);
router.post("/categories/import", upload.single("file"), expenseController_1.importExpenseCategories);
exports.default = router;
