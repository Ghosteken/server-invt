import { Request, Response } from "express";
import prisma from "../db/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { readFlags, writeFlags } from "../services/featureFlagsService";
import { createErrorResponse } from "../utils/errorHandler";

// Use shared Prisma client
// Load JWT secret from environment (server/index.ts calls dotenv.config()).
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not defined");
}
const ALL_FEATURES = [
  "reports",
  "storeSales",
  "inventory",
  "productTracker",
  "products",
  "customers",
  "invoices",
  "expenses",
  "salesAgents",
  "purchases",
  "customerGroups",
  "logistics",
  "purchasingAdvisor",
  "expenseAnomalyDetection",
];

const compareAsync = (p: string, h: string) => new Promise<boolean>((resolve) => bcrypt.compare(p, h, (err, res) => resolve(!!res)));
const hashAsync = (p: string, rounds: number) => new Promise<string>((resolve, reject) => bcrypt.hash(p, rounds, (err, res) => { if (err) reject(err); else resolve(String(res)); }));

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase();
    console.log(`auth: signup request for email=${email}`);

    // Check if user already exists
    const existingUser = await prisma.users.findFirst({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      console.log(`auth: signup failed - user already exists: ${email}`);
      res.status(400).json({ message: "User already exists" });
      return;
    }

  const hashedPassword = await hashAsync(password, 10);

    // Create new user
    const tenantIdBody = req.body?.tenantId ? String(req.body.tenantId).trim() : undefined;
    const newUser = await prisma.users.create({
      data: {
        userId: randomUUID(),
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: "user", // Default role
        ...(tenantIdBody ? { tenantId: tenantIdBody } : {}),
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.userId, email: newUser.email, role: newUser.role, tenantId: newUser.tenantId },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`auth: signup success for email=${email} userId=${newUser.userId}`);
    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        userId: newUser.userId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        tenantId: newUser.tenantId,
      },
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Error creating user"));
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase();
    console.log(`auth: login request for email=${email}`);

    const configuredAdminEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();

    // Find user
    let user = await prisma.users.findFirst({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log(`auth: login failed - user not found: ${email}`);
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

  // Compare password (sync)
  if (user.isBlocked) {
      console.log(`auth: login blocked for ${email}`);
      res.status(403).json({ message: "Account is blocked" });
      return;
    }
  const isPasswordValid = await compareAsync(password, user.password);

    if (!isPasswordValid) {
      console.log(`auth: login failed - invalid password for ${email}`);
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // No role elevation on the regular login route

    // Generate JWT token
    let features: string[] = [];
    try {
      const tenantId = user.tenantId || "default";
      const flags = await readFlags(tenantId);
      const allowed: string[] = Array.isArray((flags as any)["__allowed__"]) ? (flags as any)["__allowed__"] : ALL_FEATURES;
      const userFeatures: string[] = Array.isArray(flags[user.userId]) ? flags[user.userId] : [];
      const isAdminUser = (user.role || "").toLowerCase() === "admin";
      features = allowed
        ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
        : userFeatures;
    } catch {}
    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role, tenantId: user.tenantId, features },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`auth: login successful for ${email}`);
    res.json({
      message: "Login successful",
      token,
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Error during login"));
  }
};

export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase();
    console.log(`auth: admin login request for email=${email}`);

    // Master admin path removed; super admin login is handled via dedicated route under /super-admin

    // Org admin fallback: allow org admins to log in via this route
    const orgAdmin = await prisma.orgAdmins.findFirst({ where: { email: normalizedEmail } });
    if (orgAdmin) {
      if (orgAdmin.isBlocked) { res.status(403).json({ message: "Admin account is blocked" }); return; }
      const org = await prisma.organizations.findUnique({ where: { id: orgAdmin.orgId } });
      if (org && org.isBlocked) { res.status(403).json({ message: "Organization is blocked" }); return; }
      const ok = await compareAsync(password, orgAdmin.passwordHash);
      if (ok) {
        let features: string[] = [];
        try {
          const flags = await readFlags(orgAdmin.orgId);
          const allowed: string[] = Array.isArray((flags as any)["__allowed__"]) ? (flags as any)["__allowed__"] : ALL_FEATURES;
          const userFeatures: string[] = Array.isArray(flags[orgAdmin.id]) ? flags[orgAdmin.id] : [];
          const isAdminUser = true;
          features = allowed
            ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
            : userFeatures;
        } catch {}
        const token = jwt.sign(
          { userId: orgAdmin.id, email: orgAdmin.email, role: "org_admin", tenantId: orgAdmin.orgId, features },
          JWT_SECRET,
          { expiresIn: "24h" }
        );
        res.json({ message: "Login successful", token, user: { userId: orgAdmin.id, name: orgAdmin.name, email: orgAdmin.email, role: "org_admin" } });
        return;
      }
    }

    // DB user path: require admin role
    const user = await prisma.users.findFirst({ where: { email: normalizedEmail } });
    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }
    if (user.isBlocked) {
      res.status(403).json({ message: "Account is blocked" });
      return;
    }
    const isPasswordValid = await compareAsync(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // If this email is the configured admin email, enforce admin role
    try {
      const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
      if (adminEmail && user.email.toLowerCase() === adminEmail && user.role !== "admin") {
        await prisma.users.update({ where: { userId: user.userId }, data: { role: "admin" } });
      }
    } catch {}

    if ((user.role || "").toLowerCase() !== "admin") {
      // If not admin, see if this user corresponds to an org admin record
      const fallbackOrgAdmin = await prisma.orgAdmins.findFirst({ where: { email: normalizedEmail } });
      if (fallbackOrgAdmin) {
        const ok = await compareAsync(password, fallbackOrgAdmin.passwordHash);
        if (ok) {
          const token = jwt.sign(
            { userId: fallbackOrgAdmin.id, email: fallbackOrgAdmin.email, role: "org_admin", tenantId: fallbackOrgAdmin.orgId },
            JWT_SECRET,
            { expiresIn: "24h" }
          );
          res.json({ message: "Login successful", token, user: { userId: fallbackOrgAdmin.id, name: fallbackOrgAdmin.name, email: fallbackOrgAdmin.email, role: "org_admin" } });
          return;
        }
      }
      res.status(403).json({ message: "Not an admin account" });
      return;
    }

    let tenantId: string | undefined = user.tenantId;
    if (!tenantId) {
      try {
        const org = await prisma.organizations.findFirst({ where: { adminEmail: user.email } });
        if (org?.id) tenantId = org.id;
      } catch {}
    }
    let features: string[] = [];
    try {
      const tId = tenantId || "default";
      const flags = await readFlags(tId);
      const allowed: string[] = Array.isArray((flags as any)["__allowed__"]) ? (flags as any)["__allowed__"] : ALL_FEATURES;
      const userFeatures: string[] = Array.isArray(flags[user.userId]) ? flags[user.userId] : [];
      const isAdminUser = true;
      features = allowed
        ? (userFeatures.length ? userFeatures.filter((f) => allowed.includes(f)) : (isAdminUser ? allowed.slice() : []))
        : userFeatures;
    } catch {}
    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role, ...(tenantId ? { tenantId } : {}), features },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`auth: admin login successful for ${email}`);
    res.json({
      message: "Login successful",
      token,
      user: { userId: user.userId, name: user.name, email: user.email, role: user.role, tenantId },
    });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Error during admin login"));
  }
};

export const verifyToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      res.status(401).json({ message: "No token provided" });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: string;
      tenantId?: string;
    };

    // Allow master admin token without DB lookup
    const masterEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (masterEmail && decoded.email.toLowerCase() === masterEmail) {
      let tenantId: string | undefined = decoded.tenantId;
      if (!tenantId) {
        try {
          const org = await prisma.organizations.findFirst({ where: { adminEmail: decoded.email } });
          if (org?.id) tenantId = org.id;
        } catch {}
      }
      res.json({
        user: {
          userId: decoded.userId,
          name: "Admin",
          email: decoded.email,
          role: "admin",
          tenantId,
        },
      });
      return;
    }

    const user = await prisma.users.findUnique({
      where: { userId: decoded.userId },
    });

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json({
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
    });
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export const orgAdminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || "").toLowerCase();
    if (!normalizedEmail || !password) {
      res.status(400).json({ message: "email and password are required" });
      return;
    }
    const admin = await prisma.orgAdmins.findFirst({ where: { email: normalizedEmail } });
    if (!admin) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }
    if (admin.isBlocked) {
      res.status(403).json({ message: "Admin account is blocked" });
      return;
    }
    const org = await prisma.organizations.findUnique({ where: { id: admin.orgId } });
    if (org && org.isBlocked) {
      res.status(403).json({ message: "Organization is blocked" });
      return;
    }
    const ok = await compareAsync(password, admin.passwordHash);
    if (!ok) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }
    const token = jwt.sign(
      { userId: admin.id, email: admin.email, role: "org_admin", tenantId: admin.orgId },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    res.json({ message: "Login successful", token, user: { userId: admin.id, name: admin.name, email: admin.email, role: "org_admin" } });
  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Error during org admin login"));
  }
};

export const signupOrg = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgName, adminName, email, password } = req.body;
    
    if (!orgName || !adminName || !email || !password) {
      res.status(400).json({ message: "All fields are required" });
      return;
    }

    const normalizedEmail = String(email).toLowerCase();

    // Check if email already exists
    const existingUser = await prisma.users.findFirst({ where: { email: normalizedEmail } });
    const existingOrgAdmin = await prisma.orgAdmins.findFirst({ where: { email: normalizedEmail } });
    if (existingUser || existingOrgAdmin) {
      res.status(409).json({ message: "Email already in use" });
      return;
    }

    // Check if org name exists
    const existingOrg = await prisma.organizations.findUnique({ where: { name: orgName } });
    if (existingOrg) {
       res.status(409).json({ message: "Organization name already exists" });
       return;
    }

    const passwordHash = await hashAsync(password, 10);
    const orgId = randomUUID();

    // Transaction to create Org, OrgAdmin, and User
    await prisma.$transaction(async (tx) => {
      // Create Organization
      await tx.organizations.create({
        data: {
          id: orgId,
          name: orgName,
          adminEmail: normalizedEmail,
          adminPasswordHash: passwordHash,
        }
      });

      // Create Org Admin
      const adminId = randomUUID();
      await tx.orgAdmins.create({
        data: {
          id: adminId,
          orgId: orgId,
          name: adminName,
          email: normalizedEmail,
          passwordHash: passwordHash,
        }
      });

      // Create User (for unified login if applicable)
      await tx.users.create({
        data: {
          userId: randomUUID(),
          name: adminName,
          email: normalizedEmail,
          password: passwordHash,
          role: "admin",
          tenantId: orgId,
          isBlocked: false
        }
      });
    });

    const newOrgAdmin = await prisma.orgAdmins.findFirst({ where: { email: normalizedEmail, orgId } });
    
    if (!newOrgAdmin) throw new Error("Failed to retrieve created admin");

    // Lock AI features by default for new org admins
    const allFeaturesExceptAI = ALL_FEATURES.filter(
      f => f !== "purchasingAdvisor" && f !== "expenseAnomalyDetection"
    );
    await writeFlags(
      { 
        [newOrgAdmin.id]: allFeaturesExceptAI,
        "__allowed__": allFeaturesExceptAI
      },
      orgId
    );

    const token = jwt.sign(
      { userId: newOrgAdmin.id, email: newOrgAdmin.email, role: "org_admin", tenantId: orgId },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(201).json({
      message: "Organization registered successfully",
      token,
      user: {
        userId: newOrgAdmin.id,
        name: newOrgAdmin.name,
        email: newOrgAdmin.email,
        role: "org_admin",
        tenantId: orgId
      }
    });

  } catch (err) {
    res.status(500).json(createErrorResponse(err, undefined, "Failed to register organization"));
  }
};
