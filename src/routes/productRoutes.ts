import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample, getProductById, updateProduct, exportProducts, processInvoice, processInvoiceManual, deleteProduct, purgeProducts, getProductUpdatesLast, getPcsProducts, importPcsProducts, upsertPcsItems, getPcsSample, exportProductsExcel, exportPcsExcel, reloadPcs, getProductMovements } from "../controllers/productController";
import { authenticateToken } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", authenticateToken, getProducts);
router.post("/", authenticateToken, requirePermission("products", "create"), createProduct);
router.post("/import", authenticateToken, requirePermission("inventory", "import"), upload.single("file"), importProducts);
router.get("/import/sample", authenticateToken, getImportSample);
router.get("/export", authenticateToken, requirePermission("inventory", "download"), exportProducts); // legacy JSON export
router.get("/export/excel", authenticateToken, requirePermission("inventory", "download"), exportProductsExcel);
router.get("/updates/last", authenticateToken, getProductUpdatesLast);
router.get("/pcs/sample", authenticateToken, getPcsSample);
router.get("/pcs", authenticateToken, getPcsProducts);
router.get("/pcs/export", authenticateToken, requirePermission("inventory", "download"), exportPcsExcel);
router.post("/pcs/import", authenticateToken, requirePermission("inventory", "import"), upload.single("file"), importPcsProducts);
router.post("/pcs/upsert", authenticateToken, requirePermission("inventory", "import"), upsertPcsItems);
router.post("/pcs/reload", authenticateToken, reloadPcs);
router.post("/invoice/process", authenticateToken, requirePermission("inventory", "import"), upload.single("file"), processInvoice);
router.post("/invoice/manual", authenticateToken, requirePermission("inventory", "import"), processInvoiceManual);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
// router.delete("/purge", purgeProducts); // removed per requirements
router.get("/:productId", authenticateToken, getProductById);
router.get("/:productId/movements", authenticateToken, getProductMovements);
router.put("/:productId", authenticateToken, updateProduct);
router.delete("/:productId", authenticateToken, deleteProduct);

export default router;
