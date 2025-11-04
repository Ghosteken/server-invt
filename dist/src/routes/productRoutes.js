"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const productController_1 = require("../controllers/productController");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.get("/", productController_1.getProducts);
router.post("/", productController_1.createProduct);
router.post("/import", upload.single("file"), productController_1.importProducts);
router.get("/import/sample", productController_1.getImportSample);
router.get("/export", productController_1.exportProducts);
router.post("/invoice/process", upload.single("file"), productController_1.processInvoice);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
router.delete("/purge", productController_1.purgeProducts);
router.get("/:productId", productController_1.getProductById);
router.put("/:productId", productController_1.updateProduct);
router.delete("/:productId", productController_1.deleteProduct);
exports.default = router;
