"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setOrgAdminFeatures = exports.getOrgAdminFeatures = exports.unblockOrgAdmin = exports.blockOrgAdmin = exports.unblockOrg = exports.blockOrg = exports.deleteOrg = exports.getOrg = exports.createOrgAdmin = exports.listOrgAdmins = exports.createOrg = exports.listOrgs = exports.superAdminLogin = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../db/prisma"));
const zod_1 = require("zod");
const featureFlagsService_1 = require("../services/featureFlagsService");
const errorHandler_1 = require("../utils/errorHandler");
const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";
const superAdminLogin = async (req, res) => {
    try {
        const email = String((req.body || {}).email || "").toLowerCase();
        const password = String((req.body || {}).password || "");
        const configuredEmail = String(process.env.MASTER_ADMIN_EMAIL || "").toLowerCase();
        const configuredPassword = String(process.env.MASTER_ADMIN_PASSWORD || "");
        if (!configuredEmail || !configuredPassword) {
            console.error("Super admin credentials not configured in environment");
            res.status(500).json({ message: "Server configuration error" });
            return;
        }
        if (email === configuredEmail && password === configuredPassword) {
            const token = jsonwebtoken_1.default.sign({ userId: "super-admin", email, role: "super_admin" }, JWT_SECRET, { expiresIn: "7d" });
            res.json({ token, user: { userId: "super-admin", name: "Super Admin", email, role: "super_admin" } });
            return;
        }
        res.status(401).json({ message: "Invalid credentials" });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, undefined, "Error during super admin login"));
    }
};
exports.superAdminLogin = superAdminLogin;
function requireSuperAdmin(req, res) {
    try {
        const token = req.headers.authorization?.split(" ")[1] || "";
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        if ((decoded.role || "").toLowerCase() !== "super_admin") {
            res.status(403).json({ message: "Forbidden" });
            return { ok: false };
        }
        return { ok: true, email: decoded.email };
    }
    catch {
        res.status(401).json({ message: "Invalid token" });
        return { ok: false };
    }
}
const listOrgs = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    let orgs = await prisma_1.default.organizations.findMany({ orderBy: { createdAt: "desc" } });
    if (orgs.length === 0) {
        try {
            const admin = await prisma_1.default.users.findFirst({ where: { role: "admin" } });
            if (admin) {
                const existingByEmail = await prisma_1.default.organizations.findFirst({ where: { adminEmail: admin.email } });
                if (!existingByEmail) {
                    const created = await prisma_1.default.organizations.create({
                        data: {
                            id: (0, crypto_1.randomUUID)(),
                            name: process.env.ORGANIZATION_NAME ? String(process.env.ORGANIZATION_NAME) : "Primary Organization",
                            apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || undefined,
                            adminEmail: admin.email,
                            adminPasswordHash: admin.password,
                        },
                    });
                    orgs = [created];
                }
            }
        }
        catch { }
    }
    res.json({ orgs: orgs.map((o) => ({ id: o.id, name: o.name, apiBaseUrl: o.apiBaseUrl, adminEmail: o.adminEmail, isBlocked: o.isBlocked ?? false, createdAt: o.createdAt })) });
};
exports.listOrgs = listOrgs;
const createOrg = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    try {
        const body = (req.body || {});
        const name = String(body.name || "").trim();
        const apiBaseUrl = body.apiBaseUrl ? String(body.apiBaseUrl) : undefined;
        const adminEmail = String(body.adminEmail || "").toLowerCase();
        const adminPassword = String(body.adminPassword || "");
        if (!name || !adminEmail || !adminPassword) {
            res.status(400).json({ message: "name, adminEmail and adminPassword are required" });
            return;
        }
        const passwordHash = bcryptjs_1.default.hashSync(adminPassword, 10);
        const orgId = (0, crypto_1.randomUUID)();
        const org = await prisma_1.default.organizations.create({ data: { id: orgId, name, apiBaseUrl, adminEmail, adminPasswordHash: passwordHash } });
        try {
            const existingAdmin = await prisma_1.default.orgAdmins.findFirst({ where: { orgId, email: adminEmail } });
            if (!existingAdmin) {
                const newAdmin = await prisma_1.default.orgAdmins.create({ data: { id: (0, crypto_1.randomUUID)(), orgId, name: "Admin", email: adminEmail, passwordHash } });
                // Lock AI features by default for new org admins
                const ALL_FEATURES = [
                    "reports",
                    "storeSales",
                    "inventory",
                    "productTracker",
                    "statements",
                    "products",
                    "customers",
                    "locations",
                    "invoices",
                    "expenses",
                    "expenseApproval",
                    "salesAgents",
                    "purchases",
                    "customerGroups",
                    "logistics",
                    "purchasingAdvisor",
                    "expenseAnomalyDetection"
                ];
                const allFeaturesExceptAI = ALL_FEATURES
                    .filter(f => f !== "purchasingAdvisor" && f !== "expenseAnomalyDetection")
                    .filter(f => f !== "statements");
                await (0, featureFlagsService_1.writeFlags)({
                    [newAdmin.id]: allFeaturesExceptAI,
                    "__allowed__": allFeaturesExceptAI
                }, orgId);
            }
            const existingUser = await prisma_1.default.users.findFirst({ where: { email: adminEmail, tenantId: orgId } });
            if (!existingUser) {
                await prisma_1.default.users.create({ data: { userId: (0, crypto_1.randomUUID)(), name: "Admin", email: adminEmail, password: passwordHash, role: "admin", tenantId: orgId, isBlocked: false } });
            }
        }
        catch { }
        res.status(201).json({ org: { id: org.id, name: org.name, apiBaseUrl: org.apiBaseUrl, adminEmail: org.adminEmail } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to create organization"));
    }
};
exports.createOrg = createOrg;
const listOrgAdmins = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { id } = req.params;
    let admins = await prisma_1.default.orgAdmins.findMany({ where: { orgId: id }, orderBy: { createdAt: "desc" } });
    if (admins.length === 0) {
        const tenantAdmins = await prisma_1.default.users.findMany({ where: { tenantId: id, role: "admin" } });
        for (const u of tenantAdmins) {
            const existing = await prisma_1.default.orgAdmins.findFirst({ where: { orgId: id, email: u.email } });
            if (!existing) {
                await prisma_1.default.orgAdmins.create({ data: { id: (0, crypto_1.randomUUID)(), orgId: id, name: u.name, email: u.email, passwordHash: u.password } });
            }
        }
        admins = await prisma_1.default.orgAdmins.findMany({ where: { orgId: id }, orderBy: { createdAt: "desc" } });
    }
    res.json({ admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, isBlocked: a.isBlocked ?? false })) });
};
exports.listOrgAdmins = listOrgAdmins;
const createOrgAdmin = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    try {
        const { id } = req.params;
        const body = (req.body || {});
        const name = String(body.name || "").trim() || "Admin";
        const email = String(body.email || "").toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) {
            res.status(400).json({ message: "email and password are required" });
            return;
        }
        const org = await prisma_1.default.organizations.findUnique({ where: { id } });
        if (!org) {
            res.status(404).json({ message: "Organization not found" });
            return;
        }
        const passwordHash = bcryptjs_1.default.hashSync(password, 10);
        const admin = await prisma_1.default.orgAdmins.create({ data: { id: (0, crypto_1.randomUUID)(), orgId: id, name, email, passwordHash } });
        try {
            const existingUser = await prisma_1.default.users.findFirst({ where: { email, tenantId: id } });
            if (!existingUser) {
                await prisma_1.default.users.create({ data: { userId: (0, crypto_1.randomUUID)(), name, email, password: passwordHash, role: "admin", tenantId: id, isBlocked: false } });
            }
        }
        catch { }
        res.status(201).json({ admin: { id: admin.id, name: admin.name, email: admin.email } });
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to create org admin"));
    }
};
exports.createOrgAdmin = createOrgAdmin;
const getOrg = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { id } = req.params;
    const org = await prisma_1.default.organizations.findUnique({ where: { id } });
    if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
    }
    res.json({ org: { id: org.id, name: org.name, apiBaseUrl: org.apiBaseUrl, adminEmail: org.adminEmail, isBlocked: org.isBlocked ?? false } });
};
exports.getOrg = getOrg;
const deleteOrg = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { id } = req.params;
    try {
        // Ensure org exists
        const org = await prisma_1.default.organizations.findUnique({ where: { id } });
        if (!org) {
            res.status(404).json({ message: "Organization not found" });
            return;
        }
        // Cascade delete tenant data
        await prisma_1.default.$transaction(async (tx) => {
            // Robust cleanup: find customers and invoices first to ensure related items are deleted regardless of tenantId on items
            // 1. Identify all Customers belonging to this tenant
            const customers = await tx.customers.findMany({ where: { tenantId: id }, select: { customerId: true } });
            const customerIds = customers.map(c => c.customerId);
            // 2. Identify all Invoices belonging to this tenant OR linked to these customers
            // Note: We use findMany instead of deleteMany directly to get IDs for child cleanup
            const invoices = await tx.invoices.findMany({
                where: {
                    OR: [
                        { tenantId: id },
                        { customerId: { in: customerIds.length > 0 ? customerIds : undefined } }
                    ]
                },
                select: { invoiceId: true }
            });
            const invoiceIds = invoices.map(i => i.invoiceId);
            // 3. Delete InvoiceItems (depend on Invoices)
            if (invoiceIds.length > 0) {
                await tx.invoiceItems.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
            }
            await tx.invoiceItems.deleteMany({ where: { tenantId: id } }); // Catch any orphans
            // 4. Delete Payments (depend on Invoices and Customers)
            if (invoiceIds.length > 0) {
                await tx.payments.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
            }
            if (customerIds.length > 0) {
                await tx.payments.deleteMany({ where: { customerId: { in: customerIds } } });
            }
            await tx.payments.deleteMany({ where: { tenantId: id } });
            // 5. Delete Invoices
            if (invoiceIds.length > 0) {
                await tx.invoices.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
            }
            await tx.invoices.deleteMany({ where: { tenantId: id } });
            // 6. Delete CustomerPurchases (depend on Customers)
            if (customerIds.length > 0) {
                await tx.customerPurchases.deleteMany({ where: { customerId: { in: customerIds } } });
            }
            await tx.customerPurchases.deleteMany({ where: { tenantId: id } });
            // 7. Delete Customers
            if (customerIds.length > 0) {
                await tx.customers.deleteMany({ where: { customerId: { in: customerIds } } });
            }
            await tx.customers.deleteMany({ where: { tenantId: id } });
            // Continue with other tables...
            await tx.supplierPurchaseMeta.deleteMany({ where: { tenantId: id } });
            await tx.supplierPayments.deleteMany({ where: { tenantId: id } });
            await tx.purchases.deleteMany({ where: { tenantId: id } });
            await tx.sales.deleteMany({ where: { tenantId: id } });
            await tx.expenseByCategory.deleteMany({ where: { tenantId: id } });
            await tx.expenseSummary.deleteMany({ where: { tenantId: id } });
            await tx.expenses.deleteMany({ where: { tenantId: id } });
            await tx.purchaseSummary.deleteMany({ where: { tenantId: id } });
            await tx.salesSummary.deleteMany({ where: { tenantId: id } });
            await tx.invoiceMeta.deleteMany({ where: { tenantId: id } });
            await tx.featureFlags.deleteMany({ where: { tenantId: id } });
            await tx.pcsInventory.deleteMany({ where: { tenantId: id } });
            await tx.auditLogs.deleteMany({ where: { tenantId: id } });
            await tx.supportMessages.deleteMany({ where: { tenantId: id } });
            await tx.products.deleteMany({ where: { tenantId: id } });
            await tx.customerGroups.deleteMany({ where: { tenantId: id } });
            await tx.salesAgents.deleteMany({ where: { tenantId: id } });
            await tx.locations.deleteMany({ where: { tenantId: id } });
            await tx.branches.deleteMany({ where: { tenantId: id } });
            await tx.stores.deleteMany({ where: { tenantId: id } });
            await tx.expenseCategories.deleteMany({ where: { tenantId: id } });
            await tx.banks.deleteMany({ where: { tenantId: id } });
            await tx.suppliers.deleteMany({ where: { tenantId: id } });
            await tx.users.deleteMany({ where: { tenantId: id } });
            await tx.orgAdmins.deleteMany({ where: { orgId: id } });
            await tx.organizations.delete({ where: { id } });
        }, { timeout: 60000 });
        res.json({ success: true });
    }
    catch (err) {
        console.error("Error deleting organization:", err);
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to delete organization"));
    }
};
exports.deleteOrg = deleteOrg;
const blockOrg = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { id } = req.params;
    const updated = await prisma_1.default.organizations.update({ where: { id }, data: { isBlocked: true } });
    res.json({ org: { id: updated.id, name: updated.name, isBlocked: true } });
};
exports.blockOrg = blockOrg;
const unblockOrg = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { id } = req.params;
    const updated = await prisma_1.default.organizations.update({ where: { id }, data: { isBlocked: false } });
    res.json({ org: { id: updated.id, name: updated.name, isBlocked: false } });
};
exports.unblockOrg = unblockOrg;
const blockOrgAdmin = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { orgId, adminId } = req.params;
    const admin = await prisma_1.default.orgAdmins.update({ where: { id: adminId }, data: { isBlocked: true } });
    res.json({ admin: { id: admin.id, name: admin.name, email: admin.email, isBlocked: true } });
};
exports.blockOrgAdmin = blockOrgAdmin;
const unblockOrgAdmin = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    const { orgId, adminId } = req.params;
    const admin = await prisma_1.default.orgAdmins.update({ where: { id: adminId }, data: { isBlocked: false } });
    res.json({ admin: { id: admin.id, name: admin.name, email: admin.email, isBlocked: false } });
};
exports.unblockOrgAdmin = unblockOrgAdmin;
const getOrgAdminFeatures = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    try {
        const Params = zod_1.z.object({ orgId: zod_1.z.string().min(1), adminId: zod_1.z.string().min(1) });
        const { orgId, adminId } = Params.parse(req.params);
        const flags = await (0, featureFlagsService_1.readFlags)(orgId);
        const allFeatures = [
            "reports",
            "storeSales",
            "inventory",
            "productTracker",
            "statements",
            "products",
            "customers",
            "locations",
            "invoices",
            "expenses",
            "salesAgents",
            "purchases",
            "customerGroups",
            "logistics",
            "expenseApproval",
            "purchasingAdvisor",
            "expenseAnomalyDetection",
        ];
        const list = flags[adminId] && Array.isArray(flags[adminId]) ? flags[adminId] : allFeatures;
        res.json({ features: list });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to read features"));
    }
};
exports.getOrgAdminFeatures = getOrgAdminFeatures;
const setOrgAdminFeatures = async (req, res) => {
    const auth = requireSuperAdmin(req, res);
    if (!auth.ok)
        return;
    try {
        const Params = zod_1.z.object({ orgId: zod_1.z.string().min(1), adminId: zod_1.z.string().min(1) });
        const { orgId, adminId } = Params.parse(req.params);
        const Body = zod_1.z.object({ features: zod_1.z.array(zod_1.z.string()).default([]) });
        const { features } = Body.parse(req.body || {});
        const flags = await (0, featureFlagsService_1.readFlags)(orgId);
        flags[adminId] = features;
        flags["__allowed__"] = features;
        try {
            const admin = await prisma_1.default.orgAdmins.findFirst({ where: { id: adminId, orgId } });
            if (admin) {
                const user = await prisma_1.default.users.findFirst({ where: { email: admin.email, tenantId: orgId } });
                if (user) {
                    flags[user.userId] = features;
                }
            }
        }
        catch { }
        await (0, featureFlagsService_1.writeFlags)(flags, orgId);
        res.json({ features });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Failed to write features"));
    }
};
exports.setOrgAdminFeatures = setOrgAdminFeatures;
