"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authController_1 = require("../controllers/authController");
const router = express_1.default.Router();
router.post("/login", authController_1.login);
router.post("/signup-org", authController_1.signupOrg);
router.post("/org-admin/login", authController_1.orgAdminLogin);
router.get("/verify", authController_1.verifyToken);
exports.default = router;
