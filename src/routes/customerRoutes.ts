import { Router } from "express";
import multer from "multer";
import { getCustomers, importCustomers, exportCustomersExcel, importCustomersSample, deleteCustomerPurchase, createCustomer, updateCustomer, deleteCustomer } from "../controllers/customerController";

const router = Router();

router.get("/", getCustomers);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/import", upload.single("file"), importCustomers);
router.post("/import/sample", importCustomersSample);
router.get("/export/excel", exportCustomersExcel);
router.delete("/purchases/:id", deleteCustomerPurchase);

export default router;
