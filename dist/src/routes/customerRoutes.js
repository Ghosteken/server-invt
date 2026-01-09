"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const customerController_1 = require("../controllers/customerController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get("/", authMiddleware_1.authenticateToken, customerController_1.getCustomers);
router.post("/", authMiddleware_1.authenticateToken, customerController_1.createCustomer);
router.put("/:id", authMiddleware_1.authenticateToken, customerController_1.updateCustomer);
router.delete("/:id", authMiddleware_1.authenticateToken, customerController_1.deleteCustomer);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.post("/import", authMiddleware_1.authenticateToken, upload.single("file"), customerController_1.importCustomers);
router.post("/import/sample", authMiddleware_1.authenticateToken, customerController_1.importCustomersSample);
router.get("/export/excel", customerController_1.exportCustomersExcel);
router.delete("/purchases/:id", customerController_1.deleteCustomerPurchase);
// Customer Groups
router.get("/groups", customerController_1.getCustomerGroups);
router.post("/groups", customerController_1.createCustomerGroup);
router.put("/groups/:id", customerController_1.updateCustomerGroup);
router.delete("/groups/:id", customerController_1.deleteCustomerGroup);
router.post("/groups/:id/customers", customerController_1.addCustomerToGroup);
router.delete("/groups/:id/customers/:customerId", customerController_1.removeCustomerFromGroup);
exports.default = router;
