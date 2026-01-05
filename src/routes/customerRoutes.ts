import { Router } from "express";
import multer from "multer";
import { getCustomers, importCustomers, exportCustomersExcel, importCustomersSample, deleteCustomerPurchase, createCustomer, updateCustomer, deleteCustomer, getCustomerGroups, createCustomerGroup, updateCustomerGroup, deleteCustomerGroup, addCustomerToGroup, removeCustomerFromGroup } from "../controllers/customerController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getCustomers);
router.post("/", createCustomer);
router.put("/:id", updateCustomer);
router.delete("/:id", deleteCustomer);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/import", authenticateToken, upload.single("file"), importCustomers);
router.post("/import/sample", authenticateToken, importCustomersSample);
router.get("/export/excel", exportCustomersExcel);
router.delete("/purchases/:id", deleteCustomerPurchase);
// Customer Groups
router.get("/groups", getCustomerGroups);
router.post("/groups", createCustomerGroup);
router.put("/groups/:id", updateCustomerGroup);
router.delete("/groups/:id", deleteCustomerGroup);
router.post("/groups/:id/customers", addCustomerToGroup);
router.delete("/groups/:id/customers/:customerId", removeCustomerFromGroup);

export default router;
