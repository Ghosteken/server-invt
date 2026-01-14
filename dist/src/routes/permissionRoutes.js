"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const permissionController_1 = require("../controllers/permissionController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
router.get("/:userId", authMiddleware_1.authenticateToken, permissionController_1.getPermissions);
router.put("/:userId", authMiddleware_1.authenticateToken, permissionController_1.updatePermissions);
exports.default = router;
