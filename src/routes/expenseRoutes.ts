import { Router } from "express";
import multer from "multer";
import { getExpensesByCategory, importExpenseCategories } from "../controllers/expenseController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getExpensesByCategory);
router.post("/categories/import", upload.single("file"), importExpenseCategories);

export default router;
