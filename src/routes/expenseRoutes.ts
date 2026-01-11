import { Router } from "express";
import multer from "multer";
import { getExpensesByCategory, importExpenseCategories, listExpenses, createExpense, getExpenseCategories, updateExpenseController, deleteExpenseController, createExpenseCategory, approveExpense, rejectExpense, revokeExpense } from "../controllers/expenseController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getExpensesByCategory);
router.get("/list", listExpenses);
router.get("/categories", getExpenseCategories);
router.post("/categories", requirePermission("expenses", "createCategory"), createExpenseCategory);
router.post("/", requirePermission("expenses", "create"), createExpense);
router.put("/:id", updateExpenseController);
router.delete("/:id", deleteExpenseController);
router.put("/:id/approve", authenticateToken, requireAdmin, approveExpense);
router.put("/:id/reject", authenticateToken, requireAdmin, rejectExpense);
router.put("/:id/revoke", authenticateToken, requireAdmin, revokeExpense);
router.post("/categories/import", upload.single("file"), importExpenseCategories);

export default router;
