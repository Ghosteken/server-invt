import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample, getProductById, updateProduct, exportProducts, processInvoice, processInvoiceManual, deleteProduct, purgeProducts, getProductUpdatesLast, getPcsProducts, importPcsProducts, upsertPcsItems, getPcsSample, exportProductsExcel, exportPcsExcel, reloadPcs, getProductMovements } from "../controllers/productController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getProducts);
router.post("/", authenticateToken, createProduct);
router.post("/import", authenticateToken, upload.single("file"), importProducts);
router.get("/import/sample", authenticateToken, getImportSample);
router.get("/export", authenticateToken, exportProducts); // legacy JSON export
router.get("/export/excel", authenticateToken, exportProductsExcel);
router.get("/updates/last", authenticateToken, getProductUpdatesLast);
router.get("/pcs", authenticateToken, getPcsProducts);
router.get("/pcs/sample", authenticateToken, getPcsSample);
router.get("/pcs/export", authenticateToken, exportPcsExcel);
router.post("/pcs/import", authenticateToken, upload.single("file"), importPcsProducts);
router.post("/pcs/upsert", authenticateToken, upsertPcsItems);
router.post("/pcs/reload", authenticateToken, reloadPcs);
router.post("/invoice/process", authenticateToken, upload.single("file"), processInvoice);
router.post("/invoice/manual", authenticateToken, processInvoiceManual);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
// router.delete("/purge", purgeProducts); // removed per requirements
router.get("/:productId", authenticateToken, getProductById);
router.get("/:productId/movements", authenticateToken, getProductMovements);
router.put("/:productId", authenticateToken, updateProduct);
router.delete("/:productId", authenticateToken, deleteProduct);

export default router;
