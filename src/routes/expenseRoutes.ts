import { Router } from "express";
import multer from "multer";
import { getExpensesByCategory, importExpenseCategories, listExpenses, createExpense, getExpenseCategories, updateExpenseController, deleteExpenseController, createExpenseCategory, approveExpense, rejectExpense, revokeExpense, exportExpensesExcel } from "../controllers/expenseController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authenticateToken, getExpensesByCategory);
router.get("/list", authenticateToken, listExpenses);
router.get("/export/excel", authenticateToken, exportExpensesExcel);
router.get("/categories", authenticateToken, getExpenseCategories);
router.post("/categories", authenticateToken, requirePermission("expenses", "createCategory"), createExpenseCategory);
router.post("/", authenticateToken, requirePermission("expenses", "create"), createExpense);
router.put("/:id", authenticateToken, updateExpenseController);
router.delete("/:id", authenticateToken, deleteExpenseController);
router.put("/:id/approve", authenticateToken, requireAdmin, approveExpense);
router.put("/:id/reject", authenticateToken, requireAdmin, rejectExpense);
router.put("/:id/revoke", authenticateToken, requireAdmin, revokeExpense);
router.post("/categories/import", authenticateToken, upload.single("file"), importExpenseCategories);

export default router;
