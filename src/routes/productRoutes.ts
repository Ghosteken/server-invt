import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample, getProductById, updateProduct, exportProducts, processInvoice, deleteProduct, purgeProducts } from "../controllers/productController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getProducts);
router.post("/", createProduct);
router.post("/import", upload.single("file"), importProducts);
router.get("/import/sample", getImportSample);
router.get("/export", exportProducts);
router.post("/invoice/process", upload.single("file"), processInvoice);
// Place dynamic route after specific /import routes to avoid route conflicts
// Static routes must come before dynamic ":productId" to avoid conflicts
router.delete("/purge", purgeProducts);
router.get("/:productId", getProductById);
router.put("/:productId", updateProduct);
router.delete("/:productId", deleteProduct);

export default router;
