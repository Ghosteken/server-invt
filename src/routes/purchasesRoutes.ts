import { Router } from "express";
import { getPurchases, deletePurchase, createPurchase, addPurchasePayment, updatePurchaseMeta, updatePurchase, getPurchasePrintOptions, getSuppliers, importSuppliers, exportSuppliersExcel, upload } from "../controllers/purchasesController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", getPurchases);
router.post("/", createPurchase);
router.delete("/:id", deletePurchase);
router.post("/:id/payments", addPurchasePayment);
router.put("/:id/meta", updatePurchaseMeta);
router.put("/:id", updatePurchase);
router.get("/:id/print-options", getPurchasePrintOptions);
// Suppliers
router.get("/suppliers", authenticateToken, getSuppliers);
router.post("/suppliers/import", authenticateToken, upload.single("file"), importSuppliers);
router.get("/suppliers/export/excel", authenticateToken, exportSuppliersExcel);

export default router;
