import fs from "fs";
import path from "path";

type NotificationItem = {
  id: string;
  type: string; // e.g., "product", "user"
  message: string;
  timestamp: string; // ISO
  actorUserId?: string;
};

const logDir = path.join(__dirname, "../../prisma/seedData");
const logFile = path.join(logDir, "notifications.json");

function ensureFile() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, JSON.stringify([], null, 2));
  }
}

export function appendNotification(n: Omit<NotificationItem, "id" | "timestamp"> & { timestamp?: string }) {
  try {
    ensureFile();
    const raw = fs.readFileSync(logFile, "utf-8");
    const arr: NotificationItem[] = raw.trim() ? JSON.parse(raw) : [];
    const item: NotificationItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: n.type,
      message: n.message,
      timestamp: n.timestamp || new Date().toISOString(),
      actorUserId: n.actorUserId,
    };
    arr.push(item);
    // Keep only latest 200
    const trimmed = arr.slice(Math.max(0, arr.length - 200));
    fs.writeFileSync(logFile, JSON.stringify(trimmed, null, 2));
  } catch (e) {
    console.warn("appendNotification failed", e);
  }
}

export function getLatestNotifications(limit: number = 20): NotificationItem[] {
  try {
    ensureFile();
    const raw = fs.readFileSync(logFile, "utf-8");
    const arr: NotificationItem[] = raw.trim() ? JSON.parse(raw) : [];
    return arr.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, limit);
  } catch (e) {
    console.warn("getLatestNotifications failed", e);
    return [];
  }
}