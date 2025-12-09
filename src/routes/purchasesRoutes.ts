import { Router } from "express";
import { getPurchases, deletePurchase, createPurchase, addPurchasePayment, updatePurchaseMeta, updatePurchase, getPurchasePrintOptions, getSuppliers, importSuppliers, exportSuppliersExcel, upload } from "../controllers/purchasesController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getPurchases);
router.post("/", authenticateToken, createPurchase);
router.delete("/:id", authenticateToken, deletePurchase);
router.post("/:id/payments", authenticateToken, addPurchasePayment);
router.put("/:id/meta", authenticateToken, updatePurchaseMeta);
router.put("/:id", authenticateToken, updatePurchase);
router.get("/:id/print-options", authenticateToken, getPurchasePrintOptions);
// Suppliers
router.get("/suppliers", authenticateToken, getSuppliers);
router.post("/suppliers/import", authenticateToken, upload.single("file"), importSuppliers);
router.get("/suppliers/export/excel", authenticateToken, exportSuppliersExcel);

export default router;
