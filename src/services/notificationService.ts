import prisma from "../db/prisma";

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
    const tenantId = n.tenantId || "default";
    
    await prisma.notifications.create({
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
    const count = await prisma.notifications.count({ where: { tenantId } });
    if (count > 500) {
      const toDelete = await prisma.notifications.findMany({
        where: { tenantId },
        orderBy: { timestamp: "asc" },
        take: count - 500,
        select: { id: true },
      });
      await prisma.notifications.deleteMany({
        where: { id: { in: toDelete.map((n) => n.id) } },
      });
    }
  } catch (e) {
    console.warn("appendNotification failed", e);
  }
}

export async function getLatestNotifications(
  tenantId: string,
  limit: number = 20
): Promise<NotificationItem[]> {
  try {
    const notifications = await prisma.notifications.findMany({
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
  } catch (e) {
    console.warn("getLatestNotifications failed", e);
    return [];
  }
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
    // fallback: write notification
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
