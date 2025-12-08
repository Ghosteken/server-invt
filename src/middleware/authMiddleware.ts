import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Load JWT secret from environment (server/index.ts calls dotenv.config()).
// Fallback kept for local/dev convenience but you should set JWT_SECRET in production.
const JWT_SECRET = process.env.JWT_SECRET || "inventory-management-secret-key";

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
        tenantId?: string;
      };
      tenantId?: string;
    }
  }
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
      role: string;
      tenantId?: string;
    };
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    const tenantId = decoded.tenantId || (headerTenant || "default");
    req.user = { userId: decoded.userId, email: decoded.email, role: decoded.role, tenantId };
    req.tenantId = tenantId;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const role = (req.user.role || "").toLowerCase();
  if (role !== "admin" && role !== "org_admin") {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
};
