"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const userController_1 = require("../controllers/userController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = express_1.default.Router();
// Protected route - only admins can access
router.get("/", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.getUsers);
router.post("/", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.createUser);
router.delete("/purge", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.purgeNonAdminUsers);
router.delete("/:userId", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.deleteUser);
router.patch("/:userId/block", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.blockUser);
router.patch("/:userId/unblock", authMiddleware_1.authenticateToken, authMiddleware_1.requireAdmin, userController_1.unblockUser);
exports.default = router;
