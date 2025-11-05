"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const customerController_1 = require("../controllers/customerController");
const router = (0, express_1.Router)();
router.get("/", customerController_1.getCustomers);
router.delete("/purchases/purge", customerController_1.purgeCustomerPurchases);
exports.default = router;
