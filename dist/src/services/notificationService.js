"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendNotification = appendNotification;
exports.getLatestNotifications = getLatestNotifications;
exports.appendAuditLog = appendAuditLog;
const prisma_1 = __importDefault(require("../db/prisma"));
const socket_1 = require("../socket");
async function appendNotification(n) {
    try {
        const io = (0, socket_1.getIO)();
        if (io) {
            const tenantId = n.tenantId || "default";
            const payload = {
                id: cryptoRandom(),
                tenantId,
                type: n.type,
                message: n.message,
                actorUserId: n.actorUserId || null,
                timestamp: n.timestamp ? new Date(n.timestamp).toISOString() : new Date().toISOString(),
            };
            // Emit to all clients. Client must filter by tenantId.
            io.emit("notification", payload);
        }
    }
    catch (e) {
        console.warn("appendNotification failed", e);
    }
}
async function getLatestNotifications(tenantId, limit = 20) {
    // Persistence removed as per requirement.
    // Returning empty array to satisfy contract.
    return [];
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
        // fallback: write notification (now ephemeral)
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
