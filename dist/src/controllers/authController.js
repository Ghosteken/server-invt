"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgAdminLogin = exports.verifyToken = exports.adminLogin = exports.login = exports.signup = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const featureFlagsService_1 = require("../services/featureFlagsService");
// Use shared Prisma client
// Load JWT secret from environment (server/index.ts calls dotenv.config()).
// Fallback kept for local/dev convenience but you should set JWT_SECRET in production.
const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";
const ALL_FEATURES = [
    "reports",
    "storeSales",
    "inventory",
    "productTracker",
    "products",
    "customers",
    "invoices",
    "expenses",
    "salesAgents",
    "purchases",
    "customerGroups",
    "logistics",
];
const compareAsync = (p, h) => new Promise((resolve) => bcryptjs_1.default.compare(p, h, (err, res) => resolve(!!res)));
const hashAsync = (p, rounds) => new Promise((resolve, reject) => bcryptjs_1.default.hash(p, rounds, (err, res) => { if (err)
    reject(err);
else
    resolve(String(res)); }));
const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = String(email).toLowerCase();
        console.log(`auth: signup request for email=${email}`);
        // Check if user already exists
        const existingUser = await prisma_1.default.users.findFirst({
            where: { email: normalizedEmail },
        });
        if (existingUser) {
            console.log(`auth: signup failed - user already exists: ${email}`);
            res.status(400).json({ message: "User already exists" });
            return;
        }
        const hashedPassword = await hashAsync(password, 10);
        // Create new user
        const tenantIdBody = req.body?.tenantId ? String(req.body.tenantId).trim() : undefined;
        const newUser = await prisma_1.default.users.create({
            data: {
                userId: (0, crypto_1.randomUUID)(),
                name,
                email: normalizedEmail,
                password: hashedPassword,
                role: "user", // Default role
                ...(tenantIdBody ? { tenantId: tenantIdBody } : {}),
            },
        });
        // Generate JWT token
        const token = jsonwebtoken_1.default.sign({ userId: newUser.userId, email: newUser.email, role: newUser.role, tenantId: newUser.tenantId }, JWT_SECRET, { expiresIn: "24h" });
        console.log(`auth: signup success for email=${email} userId=${newUser.userId}`);
        res.status(201).json({
            message: "User created successfully",
            token,
            user: {
                userId: newUser.userId,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                tenantId: newUser.tenantId,
            },
        });
    }
    catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ message: "Error creating user" });
    }
};
exports.signup = signup;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email).toLowerCase();
        console.log(`auth: login request for email=${email}`);
        // Disallow admin credential use on the regular login endpoint when configured via env; use /auth/admin/login instead.
        const configuredAdminEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        if (configuredAdminEmail && normalizedEmail === configuredAdminEmail) {
            res.status(403).json({ message: "Admin credentials are not allowed on this route. Use /auth/admin/login." });
            return;
        }
        // Find user
        let user = await prisma_1.default.users.findFirst({
            where: { email: normalizedEmail },
        });
        if (!user) {
            console.log(`auth: login failed - user not found: ${email}`);
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        // Compare password (sync)
        if (user.isBlocked) {
            console.log(`auth: login blocked for ${email}`);
            res.status(403).json({ message: "Account is blocked" });
            return;
        }
        const isPasswordValid = await compareAsync(password, user.password);
        if (!isPasswordValid) {
            console.log(`auth: login failed - invalid password for ${email}`);
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        // No role elevation on the regular login route
        // Generate JWT token
        let features = [];
        try {
            const tenantId = user.tenantId || "default";
            const flags = await (0, featureFlagsService_1.readFlags)(tenantId);
            const allowed = Array.isArray(flags["__allowed__"]) ? flags["__allowed__"] : ALL_FEATURES;
            const userFeatures = Array.isArray(flags[user.userId]) ? flags[user.userId] : [];
            const isAdminUser = (user.role || "").toLowerCase() === "admin";
            features = allowed
                ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
                : userFeatures;
        }
        catch { }
        const token = jsonwebtoken_1.default.sign({ userId: user.userId, email: user.email, role: user.role, tenantId: user.tenantId, features }, JWT_SECRET, { expiresIn: "24h" });
        console.log(`auth: login successful for ${email}`);
        res.json({
            message: "Login successful",
            token,
            user: {
                userId: user.userId,
                name: user.name,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
            },
        });
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Error during login" });
    }
};
exports.login = login;
const adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email).toLowerCase();
        console.log(`auth: admin login request for email=${email}`);
        // Master admin path removed; super admin login is handled via dedicated route under /super-admin
        // Org admin fallback: allow org admins to log in via this route
        const orgAdmin = await prisma_1.default.orgAdmins.findFirst({ where: { email: normalizedEmail } });
        if (orgAdmin) {
            if (orgAdmin.isBlocked) {
                res.status(403).json({ message: "Admin account is blocked" });
                return;
            }
            const org = await prisma_1.default.organizations.findUnique({ where: { id: orgAdmin.orgId } });
            if (org && org.isBlocked) {
                res.status(403).json({ message: "Organization is blocked" });
                return;
            }
            const ok = await compareAsync(password, orgAdmin.passwordHash);
            if (ok) {
                let features = [];
                try {
                    const flags = await (0, featureFlagsService_1.readFlags)(orgAdmin.orgId);
                    const allowed = Array.isArray(flags["__allowed__"]) ? flags["__allowed__"] : ALL_FEATURES;
                    const userFeatures = Array.isArray(flags[orgAdmin.id]) ? flags[orgAdmin.id] : [];
                    const isAdminUser = true;
                    features = allowed
                        ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
                        : userFeatures;
                }
                catch { }
                const token = jsonwebtoken_1.default.sign({ userId: orgAdmin.id, email: orgAdmin.email, role: "org_admin", tenantId: orgAdmin.orgId, features }, JWT_SECRET, { expiresIn: "24h" });
                res.json({ message: "Login successful", token, user: { userId: orgAdmin.id, name: orgAdmin.name, email: orgAdmin.email, role: "org_admin" } });
                return;
            }
        }
        // DB user path: require admin role
        const user = await prisma_1.default.users.findFirst({ where: { email: normalizedEmail } });
        if (!user) {
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        if (user.isBlocked) {
            res.status(403).json({ message: "Account is blocked" });
            return;
        }
        const isPasswordValid = await compareAsync(password, user.password);
        if (!isPasswordValid) {
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        // If this email is the configured admin email, enforce admin role
        try {
            const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
            if (adminEmail && user.email.toLowerCase() === adminEmail && user.role !== "admin") {
                await prisma_1.default.users.update({ where: { userId: user.userId }, data: { role: "admin" } });
            }
        }
        catch { }
        if ((user.role || "").toLowerCase() !== "admin") {
            // If not admin, see if this user corresponds to an org admin record
            const fallbackOrgAdmin = await prisma_1.default.orgAdmins.findFirst({ where: { email: normalizedEmail } });
            if (fallbackOrgAdmin) {
                const ok = await compareAsync(password, fallbackOrgAdmin.passwordHash);
                if (ok) {
                    const token = jsonwebtoken_1.default.sign({ userId: fallbackOrgAdmin.id, email: fallbackOrgAdmin.email, role: "org_admin", tenantId: fallbackOrgAdmin.orgId }, JWT_SECRET, { expiresIn: "24h" });
                    res.json({ message: "Login successful", token, user: { userId: fallbackOrgAdmin.id, name: fallbackOrgAdmin.name, email: fallbackOrgAdmin.email, role: "org_admin" } });
                    return;
                }
            }
            res.status(403).json({ message: "Not an admin account" });
            return;
        }
        let tenantId = user.tenantId;
        if (!tenantId) {
            try {
                const org = await prisma_1.default.organizations.findFirst({ where: { adminEmail: user.email } });
                if (org?.id)
                    tenantId = org.id;
            }
            catch { }
        }
        let features = [];
        try {
            const tId = tenantId || "default";
            const flags = await (0, featureFlagsService_1.readFlags)(tId);
            const allowed = Array.isArray(flags["__allowed__"]) ? flags["__allowed__"] : ALL_FEATURES;
            const userFeatures = Array.isArray(flags[user.userId]) ? flags[user.userId] : [];
            const isAdminUser = true;
            features = allowed
                ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
                : userFeatures;
        }
        catch { }
        const token = jsonwebtoken_1.default.sign({ userId: user.userId, email: user.email, role: user.role, ...(tenantId ? { tenantId } : {}), features }, JWT_SECRET, { expiresIn: "24h" });
        console.log(`auth: admin login successful for ${email}`);
        res.json({
            message: "Login successful",
            token,
            user: { userId: user.userId, name: user.name, email: user.email, role: user.role, tenantId },
        });
    }
    catch (error) {
        console.error("Admin login error:", error);
        res.status(500).json({ message: "Error during admin login" });
    }
};
exports.adminLogin = adminLogin;
const verifyToken = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            res.status(401).json({ message: "No token provided" });
            return;
        }
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // Allow master admin token without DB lookup
        const masterEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        if (masterEmail && decoded.email.toLowerCase() === masterEmail) {
            let tenantId = decoded.tenantId;
            if (!tenantId) {
                try {
                    const org = await prisma_1.default.organizations.findFirst({ where: { adminEmail: decoded.email } });
                    if (org?.id)
                        tenantId = org.id;
                }
                catch { }
            }
            res.json({
                user: {
                    userId: decoded.userId,
                    name: "Admin",
                    email: decoded.email,
                    role: "admin",
                    tenantId,
                },
            });
            return;
        }
        const user = await prisma_1.default.users.findUnique({
            where: { userId: decoded.userId },
        });
        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }
        res.json({
            user: {
                userId: user.userId,
                name: user.name,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
            },
        });
    }
    catch (error) {
        res.status(401).json({ message: "Invalid token" });
    }
};
exports.verifyToken = verifyToken;
const orgAdminLogin = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const normalizedEmail = String(email || "").toLowerCase();
        if (!normalizedEmail || !password) {
            res.status(400).json({ message: "email and password are required" });
            return;
        }
        const admin = await prisma_1.default.orgAdmins.findFirst({ where: { email: normalizedEmail } });
        if (!admin) {
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        if (admin.isBlocked) {
            res.status(403).json({ message: "Admin account is blocked" });
            return;
        }
        const org = await prisma_1.default.organizations.findUnique({ where: { id: admin.orgId } });
        if (org && org.isBlocked) {
            res.status(403).json({ message: "Organization is blocked" });
            return;
        }
        const ok = await compareAsync(password, admin.passwordHash);
        if (!ok) {
            res.status(401).json({ message: "Invalid credentials" });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ userId: admin.id, email: admin.email, role: "org_admin", tenantId: admin.orgId }, JWT_SECRET, { expiresIn: "24h" });
        res.json({ message: "Login successful", token, user: { userId: admin.id, name: admin.name, email: admin.email, role: "org_admin" } });
    }
    catch (error) {
        res.status(500).json({ message: "Error during org admin login" });
    }
};
exports.orgAdminLogin = orgAdminLogin;
