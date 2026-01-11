import { Router } from "express";
import multer from "multer";
import { getCustomers, importCustomers, exportCustomersExcel, importCustomersSample, deleteCustomerPurchase, createCustomer, updateCustomer, deleteCustomer, getCustomerGroups, createCustomerGroup, updateCustomerGroup, deleteCustomerGroup, addCustomerToGroup, removeCustomerFromGroup } from "../controllers/customerController";
import { authenticateToken } from "../middleware/authMiddleware";
import { requirePermission } from "../middleware/permissionMiddleware";

const router = Router();

router.get("/", authenticateToken, getCustomers);
router.post("/", authenticateToken, requirePermission("customers", "create"), createCustomer);
router.put("/:id", authenticateToken, requirePermission("customers", "edit"), updateCustomer);
router.delete("/:id", authenticateToken, requirePermission("customers", "delete"), deleteCustomer);
const upload = multer({ storage: multer.memoryStorage() });
router.post("/import", authenticateToken, requirePermission("customers", "import"), upload.single("file"), importCustomers);
router.post("/import/sample", authenticateToken, importCustomersSample);
router.get("/export/excel", authenticateToken, requirePermission("customers", "export"), exportCustomersExcel);
router.delete("/purchases/:id", authenticateToken, deleteCustomerPurchase);
// Customer Groups
router.get("/groups", authenticateToken, getCustomerGroups);
router.post("/groups", authenticateToken, requirePermission("customerGroups", "create"), createCustomerGroup);
router.put("/groups/:id", authenticateToken, requirePermission("customerGroups", "create"), updateCustomerGroup); // Using create permission for edit as well for now or add 'edit'
router.delete("/groups/:id", authenticateToken, requirePermission("customerGroups", "create"), deleteCustomerGroup);
router.post("/groups/:id/customers", authenticateToken, requirePermission("customerGroups", "addToGroup"), addCustomerToGroup);
router.delete("/groups/:id/customers/:customerId", authenticateToken, requirePermission("customerGroups", "addToGroup"), removeCustomerFromGroup);

export default router;
