"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const productController_1 = require("../controllers/productController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.get("/", authMiddleware_1.authenticateToken, productController_1.getProducts);
router.post("/", authMiddleware_1.authenticateToken, productController_1.createProduct);
router.post("/import", authMiddleware_1.authenticateToken, upload.single("file"), productController_1.importProducts);
router.get("/import/sample", authMiddleware_1.authenticateToken, productController_1.getImportSample);
router.get("/export", authMiddleware_1.authenticateToken, productController_1.exportProducts); // legacy JSON export
router.get("/export/excel", authMiddleware_1.authenticateToken, productController_1.exportProductsExcel);
router.get("/updates/last", authMiddleware_1.authenticateToken, productController_1.getProductUpdatesLast);
router.get("/pcs", authMiddleware_1.authenticateToken, productController_1.getPcsProducts);
router.get("/pcs/sample", authMiddleware_1.authenticateToken, productController_1.getPcsSample);
router.get("/pcs/export", authMiddleware_1.authenticateToken, productController_1.exportPcsExcel);
router.post("/pcs/import", authMiddleware_1.authenticateToken, upload.single("file"), productController_1.importPcsProducts);
router.post("/pcs/upsert", authMiddleware_1.authenticateToken, productController_1.upsertPcsItems);
router.post("/pcs/reload", authMiddleware_1.authenticateToken, productController_1.reloadPcs);
router.post("/invoice/process", authMiddleware_1.authenticateToken, upload.single("file"), productController_1.processInvoice);
router.post("/invoice/manual", authMiddleware_1.authenticateToken, productController_1.processInvoiceManual);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
// router.delete("/purge", purgeProducts); // removed per requirements
router.get("/:productId", authMiddleware_1.authenticateToken, productController_1.getProductById);
router.get("/:productId/movements", authMiddleware_1.authenticateToken, productController_1.getProductMovements);
router.put("/:productId", authMiddleware_1.authenticateToken, productController_1.updateProduct);
router.delete("/:productId", authMiddleware_1.authenticateToken, productController_1.deleteProduct);
exports.default = router;
