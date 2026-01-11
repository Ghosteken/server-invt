import { Router } from "express";
import { getPurchases, deletePurchase, createPurchase, addPurchasePayment, updatePurchaseMeta, updatePurchase, getPurchasePrintOptions, getSuppliers, importSuppliers, exportSuppliersExcel, upload, createSupplier, updateSupplier, deleteSupplier } from "../controllers/purchasesController";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get("/", authenticateToken, getPurchases);
router.post("/", authenticateToken, requirePermission("purchases", "create"), createPurchase);
router.delete("/:id", authenticateToken, deletePurchase);
router.post("/:id/payments", authenticateToken, addPurchasePayment);
router.put("/:id/meta", authenticateToken, updatePurchaseMeta);
router.put("/:id", authenticateToken, requirePermission("purchases", "edit"), updatePurchase);
router.get("/:id/print-options", authenticateToken, getPurchasePrintOptions);
// Suppliers
router.get("/suppliers", authenticateToken, getSuppliers);
router.post("/suppliers/import", authenticateToken, requirePermission("purchases", "importSuppliers"), upload.single("file"), importSuppliers);
router.get("/suppliers/export/excel", authenticateToken, requirePermission("purchases", "exportSuppliers"), exportSuppliersExcel);
router.post("/suppliers", authenticateToken, requirePermission("purchases", "createSupplier"), createSupplier);
router.put("/suppliers/:id", authenticateToken, requireAdmin, updateSupplier);
router.delete("/suppliers/:id", authenticateToken, requireAdmin, deleteSupplier);

export default router;
