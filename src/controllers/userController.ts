import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { appendNotification } from "../services/notificationService";

const prisma = new PrismaClient();

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.users.findMany({
      select: {
        userId: true,
        name: true,
        email: true,
        role: true,
        isBlocked: true,
      },
      orderBy: { name: "asc" },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving users" });
  }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body as {
      name: string;
      email: string;
      password: string;
      role?: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ message: "Name, email and password are required" });
      return;
    }

    const existing = await prisma.users.findFirst({ where: { email } });
    if (existing) {
      res.status(400).json({ message: "User with this email already exists" });
      return;
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const newUser = await prisma.users.create({
      data: {
        userId: randomUUID(),
        name,
        email,
        password: hashedPassword,
        role: (role || "user").toLowerCase(),
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
    appendNotification({
      type: "user",
      message: `User created: ${newUser.name} (${newUser.email}) as ${newUser.role}`,
      actorUserId: req.user?.userId,
    });
  } catch (error) {
    console.error("createUser error:", error);
    res.status(500).json({ message: "Error creating user" });
  }
};

export const purgeNonAdminUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prisma.users.deleteMany({
      where: { NOT: { role: "admin" } },
    });
    res.json({ message: "Purged non-admin users", deletedCount: result.count });
    appendNotification({
      type: "user",
      message: `Purged ${result.count} non-admin user(s)`,
      actorUserId: req.user?.userId,
    });
  } catch (error) {
    console.error("purgeNonAdminUsers error:", error);
    res.status(500).json({ message: "Error purging users" });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    const target = await prisma.users.findUnique({ where: { userId } });
    if (!target) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    if (target.role === "admin") {
      res.status(403).json({ message: "Cannot delete admin users" });
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
    });
  } catch (error) {
    console.error("deleteUser error:", error);
    res.status(500).json({ message: "Error deleting user" });
  }
};

export const blockUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const target = await prisma.users.findUnique({ where: { userId } });
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
    });
  } catch (error) {
    console.error("blockUser error:", error);
    res.status(500).json({ message: "Error blocking user" });
  }
};

export const unblockUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const target = await prisma.users.findUnique({ where: { userId } });
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
    });
  } catch (error) {
    console.error("unblockUser error:", error);
    res.status(500).json({ message: "Error unblocking user" });
  }
};
