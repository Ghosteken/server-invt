import prisma from "../db/prisma";
import { getIO } from "../socket";

type NotificationItem = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  actorUserId?: string;
  tenantId?: string;
};

export async function appendNotification(n: {
  type: string;
  message: string;
  actorUserId?: string;
  tenantId?: string;
  timestamp?: string;
}): Promise<void> {
  try {
    const io = getIO();
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
  } catch (e) {
    console.warn("appendNotification failed", e);
  }
}

export async function getLatestNotifications(
  tenantId: string,
  limit: number = 20
): Promise<NotificationItem[]> {
  // Persistence removed as per requirement.
  // Returning empty array to satisfy contract.
  return [];
}

export async function appendAuditLog({
  tenantId = "default",
  actorUserId,
  action,
  resourceType,
  resourceId,
  payload,
}: {
  tenantId?: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: any;
}) {
  try {
    await prisma.auditLogs.create({
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
  } catch (e) {
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

function cryptoRandom(): string {
  try {
    const { randomUUID } = require("crypto");
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
