import { Request, Response } from "express";
import { getLatestNotifications } from "../services/notificationService";

export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const limitParam = req.query.limit?.toString();
    const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 20;
    const notifications = getLatestNotifications(limit);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving notifications" });
  }
};