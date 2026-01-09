"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendNotification = appendNotification;
exports.getLatestNotifications = getLatestNotifications;
exports.appendAuditLog = appendAuditLog;
const prisma_1 = __importDefault(require("../db/prisma"));
async function appendNotification(n) {
    try {
        const tenantId = n.tenantId || "default";
        await prisma_1.default.notifications.create({
            data: {
                id: cryptoRandom(),
                tenantId,
                type: n.type,
                message: n.message,
                actorUserId: n.actorUserId || null,
                timestamp: n.timestamp ? new Date(n.timestamp) : new Date(),
            },
        });
        // Auto-cleanup: keep only latest 500 notifications per tenant
        const count = await prisma_1.default.notifications.count({ where: { tenantId } });
        if (count > 500) {
            const toDelete = await prisma_1.default.notifications.findMany({
                where: { tenantId },
                orderBy: { timestamp: "asc" },
                take: count - 500,
                select: { id: true },
            });
            await prisma_1.default.notifications.deleteMany({
                where: { id: { in: toDelete.map((n) => n.id) } },
            });
        }
    }
    catch (e) {
        console.warn("appendNotification failed", e);
    }
}
async function getLatestNotifications(tenantId, limit = 20) {
    try {
        const notifications = await prisma_1.default.notifications.findMany({
            where: { tenantId },
            orderBy: { timestamp: "desc" },
            take: Math.min(limit, 100),
        });
        return notifications.map((n) => ({
            id: n.id,
            type: n.type,
            message: n.message,
            timestamp: n.timestamp.toISOString(),
            actorUserId: n.actorUserId || undefined,
            tenantId: n.tenantId,
        }));
    }
    catch (e) {
        console.warn("getLatestNotifications failed", e);
        return [];
    }
}
async function appendAuditLog({ tenantId = "default", actorUserId, action, resourceType, resourceId, payload, }) {
    try {
        await prisma_1.default.auditLogs.create({
            data: {
                id: cryptoRandom(),
                tenantId,
                actorUserId: actorUserId || null,
                action,
                resourceType,
                resourceId: resourceId || null,
                payload: payload ?? null,
            },
        });
    }
    catch (e) {
        console.warn("appendAuditLog failed", e);
        // fallback: write notification
        await appendNotification({
            type: "audit",
            message: `${action} ${resourceType} ${resourceId || ""}`.trim(),
            actorUserId,
            tenantId,
        });
    }
}
function cryptoRandom() {
    try {
        const { randomUUID } = require("crypto");
        return randomUUID();
    }
    catch {
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}
