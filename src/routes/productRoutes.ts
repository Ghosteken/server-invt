import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample, getProductById, updateProduct, exportProducts, processInvoice, processInvoiceManual, deleteProduct, purgeProducts, getProductUpdatesLast, getPcsProducts, importPcsProducts } from "../controllers/productController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getProducts);
router.post("/", createProduct);
router.post("/import", upload.single("file"), importProducts);
router.get("/import/sample", getImportSample);
router.get("/export", exportProducts);
router.get("/updates/last", getProductUpdatesLast);
router.get("/pcs", getPcsProducts);
router.post("/pcs/import", upload.single("file"), importPcsProducts);
router.post("/invoice/process", upload.single("file"), processInvoice);
router.post("/invoice/manual", processInvoiceManual);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
router.delete("/purge", purgeProducts);
router.get("/:productId", getProductById);
router.put("/:productId", updateProduct);
router.delete("/:productId", deleteProduct);

export default router;
