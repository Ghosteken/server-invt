"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePermissions = exports.getPermissions = void 0;
const client_1 = require("@prisma/client");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
const getPermissions = async (req, res) => {
    try {
        const { userId } = req.params;
        const tenantId = req.tenantId || "default";
        // Ensure only admins or the user themselves can read permissions
        // But typically this endpoint is for the admin dashboard or the user app initialization
        // For now, let's assume valid token is enough, but strictly admin for other users
        const requestingUser = req.user;
        if (!requestingUser) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }
        // If requesting for another user, must be admin
        if (requestingUser.userId !== userId &&
            requestingUser.role !== "admin" &&
            requestingUser.role !== "org_admin" &&
            requestingUser.role !== "super_admin") {
            res.status(403).json({ message: "Forbidden" });
            return;
        }
        const perms = await prisma.userPermissions.findUnique({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId,
                },
            },
        });
        // Also fetch feature flags to return the combined state if needed, 
        // but the frontend might handle that merging. 
        // Let's just return the raw permissions object.
        res.json(perms?.permissions || {});
    }
    catch (error) {
        res.status(500).json({ message: "Error fetching permissions" });
    }
};
exports.getPermissions = getPermissions;
const updatePermissions = async (req, res) => {
    try {
        const { userId } = req.params;
        const { permissions } = req.body;
        const tenantId = req.tenantId || "default";
        // Only admins can update permissions
        const requestingUser = req.user;
        if (!requestingUser ||
            (requestingUser.role !== "admin" &&
                requestingUser.role !== "org_admin" &&
                requestingUser.role !== "super_admin")) {
            res.status(403).json({ message: "Admin access required" });
            return;
        }
        const updated = await prisma.userPermissions.upsert({
            where: {
                tenantId_userId: {
                    tenantId,
                    userId,
                },
            },
            update: {
                permissions,
            },
            create: {
                id: crypto_1.default.randomUUID(),
                tenantId,
                userId,
                permissions,
            },
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ message: "Error updating permissions" });
    }
};
exports.updatePermissions = updatePermissions;
