import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample, getProductById, updateProduct } from "../controllers/productController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getProducts);
router.post("/", createProduct);
router.post("/import", upload.single("file"), importProducts);
router.get("/import/sample", getImportSample);
// Place dynamic route after specific /import routes to avoid route conflicts
router.get("/:productId", getProductById);
router.put("/:productId", updateProduct);

export default router;
