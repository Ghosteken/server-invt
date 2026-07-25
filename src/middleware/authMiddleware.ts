import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Load JWT secret from environment dynamically (not at module load time)
// This allows tests to set JWT_SECRET before importing the middleware
function getJwtSecret(): string {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not defined");
  }
  return JWT_SECRET;
}

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

  // Demo-mode short-circuit: trust a fixed sentinel token instead of a real
  // JWT, so a fully client-side/localStorage login (no server round trip)
  // can still call authenticated endpoints against the demo deployment.
  // Only active when DEMO_MODE=true; real JWT verification below is
  // untouched for every other token.
  if (process.env.DEMO_MODE === "true" && process.env.DEMO_TOKEN && token === process.env.DEMO_TOKEN) {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    // Use the app's existing "default" fallback tenant (not a new "demo" one)
    // so routes that skip authenticateToken and derive tenantId from the
    // best-effort resolver in index.ts (which can't jwt.decode this
    // sentinel token) still land on the same tenant as the seeded data.
    const tenantId = headerTenant || "default";
    req.user = { userId: "demo-user", email: "demo@stockstudio.app", role: "admin", tenantId };
    req.tenantId = tenantId;
    return next();
  }

  try {
    const JWT_SECRET = getJwtSecret();
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
