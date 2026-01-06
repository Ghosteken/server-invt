import { Request, Response } from "express";
import { getLatestNotifications } from "../services/notificationService";
import { createErrorResponse } from "../utils/errorHandler";

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const limitParam = req.query.limit?.toString();
    const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 20;
    const notifications = await getLatestNotifications(tenantId, limit);
    res.json(notifications);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "Error retrieving notifications"));
  }
};