"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBanks = readBanks;
exports.addBank = addBank;
exports.updateBank = updateBank;
exports.removeBank = removeBank;
const prisma_1 = __importDefault(require("../db/prisma"));
// Prisma-backed persistence replacing JSON file storage
async function readBanks(tenantId) {
    try {
        const db = prisma_1.default;
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
    catch {
        return [];
    }
}
async function addBank(tenantId, bank) {
    const name = String(bank.name).trim();
    const account = String(bank.account).trim();
    try {
        const db = prisma_1.default;
        const existing = await db.banks.findFirst({ where: { tenantId, name, account } });
        if (!existing) {
            await db.banks.create({ data: { id: cryptoRandom(), tenantId, name, account } });
        }
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
    catch {
        const db = prisma_1.default;
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
}
async function updateBank(tenantId, oldBank, nextBank) {
    const oldName = String(oldBank.name).trim();
    const oldAccount = String(oldBank.account).trim();
    const name = String(nextBank.name).trim();
    const account = String(nextBank.account).trim();
    try {
        const db = prisma_1.default;
        const existing = await db.banks.findFirst({ where: { tenantId, name: oldName, account: oldAccount } });
        if (existing) {
            await db.banks.update({ where: { id: existing.id }, data: { name, account } });
        }
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
    catch {
        const db = prisma_1.default;
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
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
async function removeBank(tenantId, bank) {
    const name = String(bank.name).trim();
    const account = String(bank.account).trim();
    try {
        const db = prisma_1.default;
        const existing = await db.banks.findFirst({ where: { tenantId, name, account } });
        if (existing) {
            await db.banks.delete({ where: { id: existing.id } });
        }
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
    catch {
        const db = prisma_1.default;
        const rows = await db.banks.findMany({ where: { tenantId }, orderBy: { name: "asc" } }).catch(() => []);
        return rows.map((r) => ({ name: r.name, account: r.account }));
    }
}
