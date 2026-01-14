"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const customerController_1 = require("../controllers/customerController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const permissionMiddleware_1 = require("../middleware/permissionMiddleware");
const router = (0, express_1.Router)();
router.get("/", authMiddleware_1.authenticateToken, customerController_1.getCustomers);
router.post("/", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customers", "create"), customerController_1.createCustomer);
router.put("/:id", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customers", "edit"), customerController_1.updateCustomer);
router.delete("/:id", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customers", "delete"), customerController_1.deleteCustomer);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.post("/import", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customers", "import"), upload.single("file"), customerController_1.importCustomers);
router.post("/import/sample", authMiddleware_1.authenticateToken, customerController_1.importCustomersSample);
router.get("/export/excel", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customers", "export"), customerController_1.exportCustomersExcel);
router.delete("/purchases/:id", authMiddleware_1.authenticateToken, customerController_1.deleteCustomerPurchase);
// Customer Groups
router.get("/groups", authMiddleware_1.authenticateToken, customerController_1.getCustomerGroups);
router.post("/groups", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customerGroups", "create"), customerController_1.createCustomerGroup);
router.put("/groups/:id", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customerGroups", "create"), customerController_1.updateCustomerGroup); // Using create permission for edit as well for now or add 'edit'
router.delete("/groups/:id", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customerGroups", "create"), customerController_1.deleteCustomerGroup);
router.post("/groups/:id/customers", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customerGroups", "addToGroup"), customerController_1.addCustomerToGroup);
router.delete("/groups/:id/customers/:customerId", authMiddleware_1.authenticateToken, (0, permissionMiddleware_1.requirePermission)("customerGroups", "addToGroup"), customerController_1.removeCustomerFromGroup);
exports.default = router;
