"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFlags = exports.readFlags = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const readFlags = async (tenantId = "default") => {
    const rows = await prisma_1.default.featureFlags.findMany({ where: { tenantId } });
    const out = {};
    for (const r of rows) {
        const arr = Array.isArray(r.features) ? r.features : [];
        out[r.userId] = arr;
    }
    return out;
};
exports.readFlags = readFlags;
const writeFlags = async (flags, tenantId = "default") => {
    const ids = Object.keys(flags);
    for (const userId of ids) {
        const features = flags[userId] || [];
        await prisma_1.default.featureFlags.upsert({
            where: { tenantId_userId: { tenantId, userId } },
            create: { id: cryptoRandom(), tenantId, userId, features },
            update: { features },
        });
    }
};
exports.writeFlags = writeFlags;
function cryptoRandom() {
    try {
        const { randomUUID } = require("crypto");
        return randomUUID();
    }
    catch {
        return Math.random().toString(36).slice(2);
    }
}
