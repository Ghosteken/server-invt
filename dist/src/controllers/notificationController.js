"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = void 0;
const notificationService_1 = require("../services/notificationService");
const errorHandler_1 = require("../utils/errorHandler");
const getNotifications = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const limitParam = req.query.limit?.toString();
        const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 20;
        const notifications = await (0, notificationService_1.getLatestNotifications)(tenantId, limit);
        res.json(notifications);
    }
    catch (err) {
        res.status(500).json((0, errorHandler_1.createErrorResponse)(err, "Error retrieving notifications"));
    }
};
exports.getNotifications = getNotifications;
