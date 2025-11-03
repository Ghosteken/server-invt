import { Router } from "express";
import multer from "multer";
import { createProduct, getProducts, importProducts, getImportSample } from "../controllers/productController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", getProducts);
router.post("/", createProduct);
router.post("/import", upload.single("file"), importProducts);
router.get("/import/sample", getImportSample);

export default router;
