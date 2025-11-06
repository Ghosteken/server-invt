"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const customerController_1 = require("../controllers/customerController");
const router = (0, express_1.Router)();
router.get("/", customerController_1.getCustomers);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
router.post("/import", upload.single("file"), customerController_1.importCustomers);
router.post("/import/sample", customerController_1.importCustomersSample);
router.get("/export/excel", customerController_1.exportCustomersExcel);
exports.default = router;
