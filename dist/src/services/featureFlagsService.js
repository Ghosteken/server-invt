"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFlags = exports.readFlags = void 0;
const prisma_1 = __importDefault(require("../db/prisma"));
const readFlags = async () => {
    const rows = await prisma_1.default.featureFlags.findMany({});
    const out = {};
    for (const r of rows) {
        const arr = Array.isArray(r.features) ? r.features : [];
        out[r.userId] = arr;
    }
    return out;
};
exports.readFlags = readFlags;
const writeFlags = async (flags) => {
    const ids = Object.keys(flags);
    // Upsert each user features JSON atomically
    for (const userId of ids) {
        const features = flags[userId] || [];
        await prisma_1.default.featureFlags.upsert({
            where: { userId },
            create: { userId, features },
            update: { features },
        });
    }
};
exports.writeFlags = writeFlags;
