"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUser = exports.unblockUser = exports.blockUser = exports.deleteUser = exports.purgeNonAdminUsers = exports.createUser = exports.getUsers = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = require("crypto");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const notificationService_1 = require("../services/notificationService");
// Use shared Prisma client
const getUsers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const users = await prisma_1.default.users.findMany({
            select: {
                userId: true,
                name: true,
                email: true,
                role: true,
                isBlocked: true,
            },
            where: { tenantId },
            orderBy: { name: "asc" },
        });
        res.json(users);
    }
    catch (error) {
        console.error("getUsers error:", error);
        res.status(500).json({ message: "Error retrieving users" });
    }
};
exports.getUsers = getUsers;
const createUser = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password) {
            res.status(400).json({ message: "Name, email and password are required" });
            return;
        }
        const normalizedEmail = String(email).trim().toLowerCase();
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        // Check globally to respect the DB-level unique constraint on email
        const existing = await prisma_1.default.users.findFirst({ where: { email: normalizedEmail } });
        if (existing) {
            res.status(400).json({ message: "User with this email already exists (possibly in another organization)" });
            return;
        }
        const hashedPassword = bcryptjs_1.default.hashSync(password, 10);
        const newUser = await prisma_1.default.users.create({
            data: {
                userId: (0, crypto_1.randomUUID)(),
                name,
                email: normalizedEmail,
                password: hashedPassword,
                role: (role || "user").toLowerCase(),
                tenantId,
            },
        });
        // Append to a simple JSON audit log (no plaintext passwords)
        try {
            const logDir = node_path_1.default.join(__dirname, "../../prisma/seedData");
            const logFile = node_path_1.default.join(logDir, "createdUsers.json");
            const record = {
                userId: newUser.userId,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                createdAt: new Date().toISOString(),
            };
            let existingLogs = [];
            if (node_fs_1.default.existsSync(logFile)) {
                try {
                    existingLogs = JSON.parse(node_fs_1.default.readFileSync(logFile, "utf-8"));
                }
                catch { }
            }
            existingLogs.push(record);
            node_fs_1.default.writeFileSync(logFile, JSON.stringify(existingLogs, null, 2));
        }
        catch (e) {
            // Non-blocking: if logging fails, still return success
            console.warn("createUser: failed to write audit log", e);
        }
        res.status(201).json({
            userId: newUser.userId,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
        });
        (0, notificationService_1.appendNotification)({
            type: "user",
            message: `User created: ${newUser.name} (${newUser.email}) as ${newUser.role}`,
            actorUserId: req.user?.userId,
        });
    }
    catch (error) {
        console.error("createUser error:", error);
        res.status(500).json({ message: "Error creating user" });
    }
};
exports.createUser = createUser;
const purgeNonAdminUsers = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const result = await prisma_1.default.users.deleteMany({
            where: { tenantId, NOT: { role: "admin" } },
        });
        res.json({ message: "Purged non-admin users", deletedCount: result.count });
        (0, notificationService_1.appendNotification)({
            type: "user",
            message: `Purged ${result.count} non-admin user(s)`,
            actorUserId: req.user?.userId,
        });
    }
    catch (error) {
        console.error("purgeNonAdminUsers error:", error);
        res.status(500).json({ message: "Error purging users" });
    }
};
exports.purgeNonAdminUsers = purgeNonAdminUsers;
const deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const target = await prisma_1.default.users.findUnique({ where: { userId } });
        if (!target) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (target.tenantId !== tenantId) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (target.role === "admin") {
            res.status(403).json({ message: "Cannot delete admin users" });
            return;
        }
        // Prevent deleting self
        if (req.user?.userId === userId) {
            res.status(403).json({ message: "Cannot delete current admin user" });
            return;
        }
        await prisma_1.default.users.delete({ where: { userId } });
        res.json({ message: "User deleted" });
        (0, notificationService_1.appendNotification)({
            type: "user",
            message: `User deleted: ${target.name} (${target.email})`,
            actorUserId: req.user?.userId,
        });
    }
    catch (error) {
        console.error("deleteUser error:", error);
        res.status(500).json({ message: "Error deleting user" });
    }
};
exports.deleteUser = deleteUser;
const blockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const target = await prisma_1.default.users.findUnique({ where: { userId } });
        if (!target) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (target.tenantId !== tenantId) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (target.role === "admin") {
            res.status(403).json({ message: "Cannot block admin users" });
            return;
        }
        if (req.user?.userId === userId) {
            res.status(403).json({ message: "Cannot block current admin user" });
            return;
        }
        const updated = await prisma_1.default.users.update({
            where: { userId },
            data: { isBlocked: true },
            select: { userId: true, name: true, email: true, role: true, isBlocked: true },
        });
        res.json(updated);
        (0, notificationService_1.appendNotification)({
            type: "user",
            message: `User blocked: ${updated.name} (${updated.email})`,
            actorUserId: req.user?.userId,
        });
    }
    catch (error) {
        console.error("blockUser error:", error);
        res.status(500).json({ message: "Error blocking user" });
    }
};
exports.blockUser = blockUser;
const unblockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const target = await prisma_1.default.users.findUnique({ where: { userId } });
        if (!target) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        if (target.tenantId !== tenantId) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const updated = await prisma_1.default.users.update({
            where: { userId },
            data: { isBlocked: false },
            select: { userId: true, name: true, email: true, role: true, isBlocked: true },
        });
        res.json(updated);
        (0, notificationService_1.appendNotification)({
            type: "user",
            message: `User unblocked: ${updated.name} (${updated.email})`,
            actorUserId: req.user?.userId,
        });
    }
    catch (error) {
        console.error("unblockUser error:", error);
        res.status(500).json({ message: "Error unblocking user" });
    }
};
exports.unblockUser = unblockUser;
const updateUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const Body = (req.body || {});
        const target = await prisma_1.default.users.findUnique({ where: { userId } });
        if (!target) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        if (target.tenantId !== tenantId) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        const data = {};
        let newEmail = null;
        if (typeof Body.email === "string" && Body.email.trim()) {
            const normalized = Body.email.trim().toLowerCase();
            const exists = await prisma_1.default.users.findFirst({ where: { tenantId, email: normalized, NOT: { userId } } });
            if (exists) {
                res.status(400).json({ message: "Email already in use" });
                return;
            }
            data.email = normalized;
            newEmail = normalized;
        }
        if (typeof Body.password === "string" && Body.password.trim()) {
            const hashed = bcryptjs_1.default.hashSync(Body.password.trim(), 10);
            data.password = hashed;
        }
        if (Object.keys(data).length === 0) {
            res.status(400).json({ message: "No changes provided" });
            return;
        }
        const updated = await prisma_1.default.users.update({ where: { userId }, data, select: { userId: true, name: true, email: true, role: true, isBlocked: true, tenantId: true } });
        if ((target.role || "").toLowerCase() === "admin") {
            try {
                // Update primary admin email for organization
                if (newEmail) {
                    await prisma_1.default.organizations.updateMany({ where: { id: tenantId }, data: { adminEmail: newEmail } });
                }
                // Sync orgAdmins record
                const oldEmail = target.email;
                const orgAdmin = await prisma_1.default.orgAdmins.findFirst({ where: { orgId: tenantId, email: oldEmail } });
                if (orgAdmin) {
                    const changes = {};
                    if (newEmail)
                        changes.email = newEmail;
                    if (data.password)
                        changes.passwordHash = data.password;
                    if (Object.keys(changes).length)
                        await prisma_1.default.orgAdmins.update({ where: { id: orgAdmin.id }, data: changes });
                }
                else if (newEmail || data.password) {
                    await prisma_1.default.orgAdmins.create({ data: { id: (0, crypto_1.randomUUID)(), orgId: tenantId, name: target.name, email: newEmail || oldEmail, passwordHash: data.password || bcryptjs_1.default.hashSync("changeme", 10) } });
                }
            }
            catch (syncErr) {
                console.warn("updateUser: failed to sync super-admin org admin record", syncErr);
            }
        }
        res.json(updated);
    }
    catch (error) {
        console.error("updateUser error:", error);
        res.status(500).json({ message: "Error updating user" });
    }
};
exports.updateUser = updateUser;
