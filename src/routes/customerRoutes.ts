import { Router } from "express";
import multer from "multer";
import { getCustomers, importCustomers, exportCustomersExcel, importCustomersSample } from "../controllers/customerController";

const router = Router();

router.get("/", getCustomers);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/import", upload.single("file"), importCustomers);
router.post("/import/sample", importCustomersSample);
router.get("/export/excel", exportCustomersExcel);

export default router;
