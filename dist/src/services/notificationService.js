"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendNotification = appendNotification;
exports.getLatestNotifications = getLatestNotifications;
exports.appendAuditLog = appendAuditLog;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = __importDefault(require("../db/prisma"));
const logDir = path_1.default.join(__dirname, "../../prisma/seedData");
const logFile = path_1.default.join(logDir, "notifications.json");
function ensureFile() {
    if (!fs_1.default.existsSync(logDir)) {
        fs_1.default.mkdirSync(logDir, { recursive: true });
    }
    if (!fs_1.default.existsSync(logFile)) {
        fs_1.default.writeFileSync(logFile, JSON.stringify([], null, 2));
    }
}
function appendNotification(n) {
    try {
        ensureFile();
        const raw = fs_1.default.readFileSync(logFile, "utf-8");
        const arr = raw.trim() ? JSON.parse(raw) : [];
        const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: n.type,
            message: n.message,
            timestamp: n.timestamp || new Date().toISOString(),
            actorUserId: n.actorUserId,
        };
        arr.push(item);
        // Keep only latest 200
        const trimmed = arr.slice(Math.max(0, arr.length - 200));
        fs_1.default.writeFileSync(logFile, JSON.stringify(trimmed, null, 2));
    }
    catch (e) {
        console.warn("appendNotification failed", e);
    }
}
function getLatestNotifications(limit = 20) {
    try {
        ensureFile();
        const raw = fs_1.default.readFileSync(logFile, "utf-8");
        const arr = raw.trim() ? JSON.parse(raw) : [];
        return arr.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, limit);
    }
    catch (e) {
        console.warn("getLatestNotifications failed", e);
        return [];
    }
}
async function appendAuditLog({ tenantId = "default", actorUserId, action, resourceType, resourceId, payload }) {
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
        // fallback: also write a notification entry for visibility
        appendNotification({ type: "audit", message: `${action} ${resourceType} ${resourceId || ""}`.trim(), actorUserId });
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
