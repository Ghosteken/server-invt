"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const purchasesController_1 = require("../controllers/purchasesController");
const router = (0, express_1.Router)();
router.get("/", purchasesController_1.getPurchases);
router.post("/", purchasesController_1.createPurchase);
router.delete("/:id", purchasesController_1.deletePurchase);
router.post("/:id/payments", purchasesController_1.addPurchasePayment);
router.put("/:id/meta", purchasesController_1.updatePurchaseMeta);
router.put("/:id", purchasesController_1.updatePurchase);
router.get("/:id/print-options", purchasesController_1.getPurchasePrintOptions);
// Suppliers
router.get("/suppliers", purchasesController_1.getSuppliers);
router.post("/suppliers/import", purchasesController_1.upload.single("file"), purchasesController_1.importSuppliers);
router.get("/suppliers/export/excel", purchasesController_1.exportSuppliersExcel);
exports.default = router;
