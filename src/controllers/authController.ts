import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
// Load JWT secret from environment (server/index.ts calls dotenv.config()).
// Fallback kept for local/dev convenience but you should set JWT_SECRET in production.
const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";

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

  // Hash password (using bcryptjs sync to avoid native bindings)
  const hashedPassword = bcrypt.hashSync(password, 10);

    // Create new user
    const newUser = await prisma.users.create({
      data: {
        userId: randomUUID(),
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: "user", // Default role
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.userId, email: newUser.email, role: newUser.role },
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
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Error creating user" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase();
    console.log(`auth: login request for email=${email}`);

    // Disallow admin credential use on the regular login endpoint. Use /auth/admin/login instead.
    const configuredAdminEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
    if (normalizedEmail === configuredAdminEmail) {
      res.status(403).json({ message: "Admin credentials are not allowed on this route. Use /auth/admin/login." });
      return;
    }

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
  const isPasswordValid = bcrypt.compareSync(password, user.password);

    if (!isPasswordValid) {
      console.log(`auth: login failed - invalid password for ${email}`);
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // No role elevation on the regular login route

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role },
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
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Error during login" });
  }
};

export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase();
    console.log(`auth: admin login request for email=${email}`);

    // Master admin path: authenticate purely against environment-configured credentials
    const masterEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
    const masterPassword = process.env.MASTER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "admin2@12ad";
    if (normalizedEmail === masterEmail && password === masterPassword) {
      const masterUser = {
        userId: "master-admin",
        name: "Master Admin",
        email: masterEmail,
        role: "admin",
      };
      const token = jwt.sign(
        { userId: masterUser.userId, email: masterUser.email, role: masterUser.role },
        JWT_SECRET,
        { expiresIn: "24h" }
      );
      console.log(`auth: master admin login successful for ${normalizedEmail}`);
      res.json({ message: "Login successful", token, user: masterUser });
      return;
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
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // If this email is the configured admin email, enforce admin role
    try {
      const adminEmail = (process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
      if (user.email.toLowerCase() === adminEmail && user.role !== "admin") {
        await prisma.users.update({ where: { userId: user.userId }, data: { role: "admin" } });
      }
    } catch {}

    if ((user.role || "").toLowerCase() !== "admin") {
      res.status(403).json({ message: "Not an admin account" });
      return;
    }

    const token = jwt.sign(
      { userId: user.userId, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(`auth: admin login successful for ${email}`);
    res.json({
      message: "Login successful",
      token,
      user: { userId: user.userId, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ message: "Error during admin login" });
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
    };

    // Allow master admin token without DB lookup
    const masterEmail = (process.env.MASTER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@inventory.com").toLowerCase();
    if (decoded.email.toLowerCase() === masterEmail) {
      res.json({
        user: {
          userId: decoded.userId,
          name: "Master Admin",
          email: decoded.email,
          role: "admin",
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
      },
    });
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};