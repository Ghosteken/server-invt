"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSupplierMeta = readSupplierMeta;
exports.upsertSupplierMeta = upsertSupplierMeta;
exports.getSupplierMetaFor = getSupplierMetaFor;
exports.readSupplierPayments = readSupplierPayments;
exports.addSupplierPayment = addSupplierPayment;
exports.getPaymentsForPurchase = getPaymentsForPurchase;
exports.readSuppliers = readSuppliers;
exports.writeSuppliers = writeSuppliers;
exports.readSuppliersForTenant = readSuppliersForTenant;
exports.writeSuppliersForTenant = writeSuppliersForTenant;
const prisma_1 = __importDefault(require("../db/prisma"));
const node_crypto_1 = require("node:crypto");
async function getTenantForPurchase(purchaseId) {
    try {
        const row = await prisma_1.default.purchases.findUnique({ where: { purchaseId } });
        return row?.tenantId || null;
    }
    catch {
        return null;
    }
}
function readSupplierMeta() {
    return [];
}
function upsertSupplierMeta(entry) {
    META_CACHE.set(entry.purchaseId, {
        purchaseId: entry.purchaseId,
        supplierName: entry.supplierName ?? null,
        supplierMobile: entry.supplierMobile ?? null,
        paymentTerm: entry.paymentTerm ?? null,
        date: entry.date ?? null,
        dueDate: entry.dueDate ?? null,
        unit: entry.unit ?? null,
    });
    (async () => {
        const tenantId = await getTenantForPurchase(entry.purchaseId);
        const data = {
            tenantId: tenantId || "default",
            purchaseId: entry.purchaseId,
            supplierName: entry.supplierName ?? undefined,
            supplierMobile: entry.supplierMobile ?? undefined,
            paymentTerm: entry.paymentTerm ?? undefined,
            date: entry.date ? new Date(entry.date) : undefined,
            dueDate: entry.dueDate ? new Date(entry.dueDate) : undefined,
            unit: entry.unit ?? undefined,
        };
        try {
            await prisma_1.default.supplierPurchaseMeta.upsert({
                where: { purchaseId: entry.purchaseId },
                update: data,
                create: data,
            });
        }
        catch { }
    })();
}
function getSupplierMetaFor(purchaseId) {
    return META_CACHE.get(purchaseId);
}
// Payments helpers
function readSupplierPayments() {
    return [];
}
function addSupplierPayment(entry) {
    (async () => {
        const tenantId = await getTenantForPurchase(entry.purchaseId);
        try {
            await prisma_1.default.supplierPayments.create({
                data: {
                    id: entry.id,
                    tenantId: tenantId || "default",
                    purchaseId: entry.purchaseId,
                    date: new Date(entry.date),
                    amount: entry.amount,
                    bankName: entry.bankName,
                    bankAccount: entry.bankAccount,
                    notes: entry.notes ?? undefined,
                },
            });
        }
        catch { }
    })();
    return entry;
}
function getPaymentsForPurchase(purchaseId) {
    try {
        const rows = prisma_1.default.supplierPayments.findMany({ where: { purchaseId }, orderBy: { date: "desc" } });
        return [];
    }
    catch {
        return [];
    }
}
function readSuppliers() {
    return [];
}
function writeSuppliers(next) {
    (async () => {
        for (const s of next) {
            try {
                await prisma_1.default.suppliers.upsert({
                    where: { tenantId_name: { tenantId: "default", name: s.name } },
                    update: { mobile: s.mobile ?? undefined },
                    create: { id: (0, node_crypto_1.randomUUID)(), tenantId: "default", name: s.name, mobile: s.mobile ?? undefined },
                });
            }
            catch { }
        }
    })();
}
function readSuppliersForTenant(tenantId) {
    try {
        const rows = prisma_1.default.suppliers.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return [];
    }
    catch {
        return [];
    }
}
function writeSuppliersForTenant(tenantId, next) {
    (async () => {
        for (const s of next) {
            try {
                await prisma_1.default.suppliers.upsert({
                    where: { tenantId_name: { tenantId, name: s.name } },
                    update: { mobile: s.mobile ?? undefined },
                    create: { id: (0, node_crypto_1.randomUUID)(), tenantId, name: s.name, mobile: s.mobile ?? undefined },
                });
            }
            catch { }
        }
    })();
}
const META_CACHE = new Map();
