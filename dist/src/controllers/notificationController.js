"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = void 0;
const notificationService_1 = require("../services/notificationService");
const getNotifications = async (req, res) => {
    try {
        const limitParam = req.query.limit?.toString();
        const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 20;
        const notifications = (0, notificationService_1.getLatestNotifications)(limit);
        res.json(notifications);
    }
    catch (error) {
        res.status(500).json({ message: "Error retrieving notifications" });
    }
};
exports.getNotifications = getNotifications;
