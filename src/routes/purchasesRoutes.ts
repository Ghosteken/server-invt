import { Router } from "express";
import { getPurchases, deletePurchase, createPurchase, addPurchasePayment, updatePurchaseMeta, updatePurchase, getPurchasePrintOptions, getSuppliers, importSuppliers, exportSuppliersExcel, upload } from "../controllers/purchasesController";

const router = Router();

router.get("/", getPurchases);
router.post("/", createPurchase);
router.delete("/:id", deletePurchase);
router.post("/:id/payments", addPurchasePayment);
router.put("/:id/meta", updatePurchaseMeta);
router.put("/:id", updatePurchase);
router.get("/:id/print-options", getPurchasePrintOptions);
// Suppliers
router.get("/suppliers", getSuppliers);
router.post("/suppliers/import", upload.single("file"), importSuppliers);
router.get("/suppliers/export/excel", exportSuppliersExcel);

export default router;
