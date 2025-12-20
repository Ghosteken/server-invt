import { Router } from "express";
import multer from "multer";
import { getExpensesByCategory, importExpenseCategories, listExpenses, createExpense, getExpenseCategories, updateExpenseController, deleteExpenseController, createExpenseCategory, approveExpense, rejectExpense } from "../controllers/expenseController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getExpensesByCategory);
router.get("/list", listExpenses);
router.get("/categories", getExpenseCategories);
router.post("/categories", createExpenseCategory);
router.post("/", createExpense);
router.put("/:id", updateExpenseController);
router.delete("/:id", deleteExpenseController);
router.put("/:id/approve", authenticateToken, requireAdmin, approveExpense);
router.put("/:id/reject", authenticateToken, requireAdmin, rejectExpense);
router.post("/categories/import", upload.single("file"), importExpenseCategories);

export default router;
