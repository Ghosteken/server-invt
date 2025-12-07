"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertInvoiceMeta = upsertInvoiceMeta;
exports.getInvoiceMeta = getInvoiceMeta;
exports.removeInvoiceMeta = removeInvoiceMeta;
const prisma_1 = __importDefault(require("../db/prisma"));
async function upsertInvoiceMeta(entry) {
    const tenantId = entry.tenantId || "default";
    await prisma_1.default.invoiceMeta.upsert({
        where: { invoiceId: entry.invoiceId },
        create: {
            id: cryptoRandom(),
            tenantId,
            invoiceId: entry.invoiceId,
            invoiceNumber: entry.invoiceNumber ?? null,
        },
        update: {
            invoiceNumber: entry.invoiceNumber ?? null,
            tenantId,
        },
    });
}
async function getInvoiceMeta(id, tenantId) {
    const rec = await prisma_1.default.invoiceMeta.findUnique({ where: { invoiceId: id } });
    if (!rec)
        return undefined;
    if (tenantId && rec.tenantId !== tenantId)
        return undefined;
    return { invoiceId: rec.invoiceId, invoiceNumber: rec.invoiceNumber ?? null, tenantId: rec.tenantId };
}
async function removeInvoiceMeta(id) {
    try {
        await prisma_1.default.invoiceMeta.delete({ where: { invoiceId: id } });
    }
    catch { }
}
function cryptoRandom() {
    try {
        const { randomUUID } = require("crypto");
        return randomUUID();
    }
    catch {
        return Math.random().toString(36).slice(2);
    }
}
