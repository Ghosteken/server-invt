import { Request, Response } from "express";
import prisma from "../db/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { appendNotification } from "../services/notificationService";
import { createErrorResponse } from "../utils/errorHandler";

// Use shared Prisma client

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const users = await prisma.users.findMany({
      select: {
        userId: true,
        name: true,
        email: true,
        role: true,
        isBlocked: true,
      },
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error retrieving users"));
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, phone } = req.body as {
      name: string;
      email: string;
      password: string;
      role?: string;
      phone?: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ message: "Name, email and password are required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    // Check globally to respect the DB-level unique constraint on email
    const existing = await prisma.users.findFirst({ where: { email: normalizedEmail } });
    if (existing) {
      res.status(400).json({ message: "User with this email already exists (possibly in another organization)" });
      return;
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const newUser = await prisma.users.create({
      data: {
        userId: randomUUID(),
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: (role || "user").toLowerCase(),
        tenantId,
        phone: phone || null,
      },
    });

    // Append to a simple JSON audit log (no plaintext passwords)
    try {
      const logDir = path.join(__dirname, "../../prisma/seedData");
      const logFile = path.join(logDir, "createdUsers.json");
      const record = {
        userId: newUser.userId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        createdAt: new Date().toISOString(),
      };
      let existingLogs: any[] = [];
      if (fs.existsSync(logFile)) {
        try {
          existingLogs = JSON.parse(fs.readFileSync(logFile, "utf-8"));
        } catch {}
      }
      existingLogs.push(record);
      fs.writeFileSync(logFile, JSON.stringify(existingLogs, null, 2));
    } catch (e) {
      // Non-blocking: if logging fails, still return success
      console.warn("createUser: failed to write audit log", e);
    }

    res.status(201).json({
      userId: newUser.userId,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    });
    // If this is an admin created by an admin, mirror to OrgAdmins so Super Admin sees it
    try {
      if ((newUser.role || "").toLowerCase() === "admin") {
        const existingOrgAdmin = await prisma.orgAdmins.findFirst({ where: { orgId: tenantId, email: newUser.email } });
        const hashed = hashedPassword;
        if (!existingOrgAdmin) {
          await prisma.orgAdmins.create({
            data: { id: randomUUID(), orgId: tenantId, name: newUser.name || "Admin", email: newUser.email, passwordHash: hashed },
          });
        } else {
          await prisma.orgAdmins.update({ where: { id: existingOrgAdmin.id }, data: { name: newUser.name || existingOrgAdmin.name, passwordHash: hashed } });
        }
      }
    } catch (mirrorErr) {
      console.warn("createUser: failed to mirror admin into OrgAdmins", mirrorErr);
    }
    appendNotification({
      type: "user",
      message: `User created: ${newUser.name} (${newUser.email}) as ${newUser.role}`,
      actorUserId: req.user?.userId,
      tenantId,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error creating user"));
  }
};

export const purgeNonAdminUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const result = await prisma.users.deleteMany({
      where: { tenantId, NOT: { role: "admin" } },
    });
    res.json({ message: "Purged non-admin users", deletedCount: result.count });
    appendNotification({
      type: "user",
      message: `Purged ${result.count} non-admin user(s)`,
      actorUserId: req.user?.userId,
      tenantId,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error purging users"));
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const target = await prisma.users.findFirst({ where: { userId, tenantId } });
    if (!target) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (target.role === "admin") {
      // Allow deletion of admin users only by the primary org admin (first admin created with Super Admin)
      const org = await prisma.organizations.findUnique({ where: { id: tenantId } });
      const requesterEmail = String(req.user?.email || "").toLowerCase();
      const isPrimaryAdmin = org && requesterEmail && requesterEmail === String(org.adminEmail || "").toLowerCase();
      if (!isPrimaryAdmin) {
        res.status(403).json({ message: "Only the primary admin can delete admin users" });
        return;
      }
      if (String(req.user?.userId || "") === String(userId)) {
        res.status(403).json({ message: "Cannot delete current admin user" });
        return;
      }
      // Proceed to delete admin user and mirror removal from OrgAdmins
      await prisma.users.delete({ where: { userId } });
      try {
        const orgAdmin = await prisma.orgAdmins.findFirst({ where: { orgId: tenantId, email: target.email } });
        if (orgAdmin) {
          await prisma.orgAdmins.delete({ where: { id: orgAdmin.id } });
        }
      } catch (mirrorErr) {
        console.warn("deleteUser: failed to mirror delete from OrgAdmins", mirrorErr);
      }
      res.json({ message: "Admin user deleted" });
      appendNotification({
        type: "user",
        message: `Admin user deleted: ${target.name} (${target.email})`,
        actorUserId: req.user?.userId,
        tenantId,
      });
      return;
    }
    // Prevent deleting self
    if (req.user?.userId === userId) {
      res.status(403).json({ message: "Cannot delete current admin user" });
      return;
    }

    await prisma.users.delete({ where: { userId } });
    res.json({ message: "User deleted" });
    appendNotification({
      type: "user",
      message: `User deleted: ${target.name} (${target.email})`,
      actorUserId: req.user?.userId,
      tenantId,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error deleting user"));
  }
};

export const blockUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const target = await prisma.users.findFirst({ where: { userId, tenantId } });
    if (!target) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (target.role === "admin") {
      res.status(403).json({ message: "Cannot block admin users" });
      return;
    }
    if (req.user?.userId === userId) {
      res.status(403).json({ message: "Cannot block current admin user" });
      return;
    }
    const updated = await prisma.users.update({
      where: { userId },
      data: { isBlocked: true },
      select: { userId: true, name: true, email: true, role: true, isBlocked: true },
    });
    res.json(updated);
    appendNotification({
      type: "user",
      message: `User blocked: ${updated.name} (${updated.email})`,
      actorUserId: req.user?.userId,
      tenantId,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error blocking user"));
  }
};

export const unblockUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const target = await prisma.users.findFirst({ where: { userId, tenantId } });
    if (!target) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const updated = await prisma.users.update({
      where: { userId },
      data: { isBlocked: false },
      select: { userId: true, name: true, email: true, role: true, isBlocked: true },
    });
    res.json(updated);
    appendNotification({
      type: "user",
      message: `User unblocked: ${updated.name} (${updated.email})`,
      actorUserId: req.user?.userId,
      tenantId,
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error unblocking user"));
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params as { userId: string };
    const Body = (req.body || {}) as { email?: string; password?: string };
    const tenantId = req.tenantId || req.user?.tenantId || "default";
    const target = await prisma.users.findFirst({ where: { userId, tenantId } });
    if (!target) { res.status(404).json({ message: "User not found" }); return; }
    const data: any = {};
    let newEmail: string | null = null;
    if (typeof Body.email === "string" && Body.email.trim()) {
      const normalized = Body.email.trim().toLowerCase();
      const exists = await prisma.users.findFirst({ where: { tenantId, email: normalized, NOT: { userId } } });
      if (exists) { res.status(400).json({ message: "Email already in use" }); return; }
      data.email = normalized;
      newEmail = normalized;
    }
    if (typeof Body.password === "string" && Body.password.trim()) {
      const hashed = bcrypt.hashSync(Body.password.trim(), 10);
      data.password = hashed;
    }
    if (Object.keys(data).length === 0) { res.status(400).json({ message: "No changes provided" }); return; }
    const updated = await prisma.users.update({ where: { userId }, data, select: { userId: true, name: true, email: true, role: true, isBlocked: true, tenantId: true } });

    if ((target.role || "").toLowerCase() === "admin") {
      try {
        // Update primary admin email for organization
        if (newEmail) {
          await prisma.organizations.updateMany({ where: { id: tenantId }, data: { adminEmail: newEmail } });
        }
        // Sync orgAdmins record
        const oldEmail = target.email;
        const orgAdmin = await prisma.orgAdmins.findFirst({ where: { orgId: tenantId, email: oldEmail } });
        if (orgAdmin) {
          const changes: any = {};
          if (newEmail) changes.email = newEmail;
          if (data.password) changes.passwordHash = data.password;
          if (Object.keys(changes).length) await prisma.orgAdmins.update({ where: { id: orgAdmin.id }, data: changes });
        } else if (newEmail || data.password) {
          await prisma.orgAdmins.create({ data: { id: randomUUID(), orgId: tenantId, name: target.name, email: newEmail || oldEmail, passwordHash: data.password || bcrypt.hashSync("changeme", 10) } });
        }
      } catch (syncErr) {
        console.warn("updateUser: failed to sync super-admin org admin record", syncErr);
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json(createErrorResponse(err, "user", "Error updating user"));
  }
};
