import express from "express";
import { z, ZodError } from "zod";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import compression from "compression";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import prisma from "./db/prisma";
/* ROUTE IMPORTS */
import dashboardRoutes from "./routes/dashboardRoutes";
import productRoutes from "./routes/productRoutes";
import userRoutes from "./routes/userRoutes";
import expenseRoutes from "./routes/expenseRoutes";
import authRoutes from "./routes/authRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import customerRoutes from "./routes/customerRoutes";
import reportRoutes from "./routes/reportRoutes";
import storeSalesRoutes from "./routes/storeSalesRoutes";
import storesRoutes from "./routes/storesRoutes";
import { ensureAdminUser } from "./services/adminBootstrap";
import settingsRoutes from "./routes/settingsRoutes";
import purchasesRoutes from "./routes/purchasesRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";
import salesAgentRoutes from "./routes/salesAgentRoutes";
import locationRoutes from "./routes/locationRoutes";
import superAdminRoutes from "./routes/superAdminRoutes";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";

/* CONFIGURATIONS */
dotenv.config();
const app = express();
// Enable gzip compression (Brotli is handled by proxies/CDNs if present)
app.use(compression());
app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  }
}));
if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
  app.set("trust proxy", 1);
  app.use(helmet.hsts({ maxAge: 63072000 }));
}
app.use(morgan("common"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

// Resolve tenant for isolation: prefer 'x-tenant-id' header; else derive from JWT if present
app.use((req, _res, next) => {
  try {
    const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
    if (headerTenant) {
      (req as any).tenantId = headerTenant;
      next();
      return;
    }
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (token) {
      const decoded = jwt.decode(token) as { tenantId?: string } | null;
      if (decoded && decoded.tenantId) {
        (req as any).tenantId = decoded.tenantId;
      }
    }
  } catch {}
  next();
});

// Basic rate limiting to protect hot endpoints
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  keyGenerator: (req) => {
    const tid = (req as any).tenantId || req.user?.tenantId || "default";
    const uid = req.user?.userId || req.ip;
    return `${tid}:${uid}`;
  },
  skip: (req) => req.method === 'GET' && req.path.startsWith('/users'),
});
app.use(limiter);

// Simple request logger that prints method, url and body for debugging
app.use((req, res, next) => {
  try {
    const safeBody = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${safeBody}`);
  } catch (e) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
  }
  next();
});

/* STATIC FILES */
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

/* ROUTES */
app.use("/auth", authRoutes); // http://localhost:8000/auth
app.use("/dashboard", dashboardRoutes); // http://localhost:8000/dashboard
app.use("/products", productRoutes); // http://localhost:8000/products
app.use("/users", userRoutes); // http://localhost:8000/users
app.use("/expenses", expenseRoutes); // http://localhost:8000/expenses
app.use("/notifications", notificationRoutes); // http://localhost:8000/notifications
app.use("/customers", customerRoutes); // http://localhost:8000/customers
app.use("/reports", reportRoutes); // http://localhost:8000/reports
app.use("/settings", settingsRoutes); // http://localhost:8000/settings
app.use("/store-sales", storeSalesRoutes); // http://localhost:8000/store-sales
app.use("/stores", storesRoutes); // http://localhost:8000/stores
app.use("/invoices", invoiceRoutes); // http://localhost:8000/invoices
app.use("/purchases", purchasesRoutes); // http://localhost:8000/purchases
app.use("/sales-agents", salesAgentRoutes); // http://localhost:8000/sales-agents
app.use("/locations", locationRoutes); // http://localhost:8000/locations
app.use("/super-admin", superAdminRoutes); // http://localhost:8000/super-admin

try {
  const swaggerDocument = YAML.load(path.join(__dirname, "../swagger/swagger.yaml"));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (e) {
  console.warn("Swagger YAML not found or invalid; /docs disabled");
}

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", db: "down" });
  }
});

app.get("/status", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get("/legal/terms", (_req, res) => {
  res.json({ name: "Terms of Service", version: "1.0" });
});

app.get("/legal/privacy", (_req, res) => {
  res.json({ name: "Privacy Policy", version: "1.0" });
});

app.get("/legal/dpa", (_req, res) => {
  res.json({ name: "Data Processing Addendum", version: "1.0" });
});

app.post("/support/messages", async (req, res) => {
  try {
    const Body = z.object({ subject: z.string().min(1), body: z.string().min(1) });
    const { subject, body } = Body.parse(req.body || {});
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const created = await prisma.supportMessages.create({ data: { id: randomUUID(), tenantId, userId: req.user?.userId || null, subject, body } });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to create support message" });
  }
});

app.get("/support/messages", async (req, res) => {
  try {
    const Query = z.object({ status: z.string().optional() });
    const { status } = Query.parse(req.query);
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const messages = await prisma.supportMessages.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" } });
    res.json({ messages });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to read support messages" });
  }
});

app.put("/support/messages/:id/status", async (req, res) => {
  try {
    const Params = z.object({ id: z.string().min(1) });
    const { id } = Params.parse(req.params);
    const Body = z.object({ status: z.enum(["open", "pending", "closed"]) });
    const { status } = Body.parse(req.body || {});
    const tenantId = (req as any).tenantId || req.user?.tenantId || "default";
    const existing = await prisma.supportMessages.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== tenantId) {
      res.status(404).json({ message: "Message not found" });
      return;
    }
    const updated = await prisma.supportMessages.update({ where: { id }, data: { status } });
    res.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ message: "Invalid input", errors: err.issues });
      return;
    }
    res.status(500).json({ message: "Failed to update message status" });
  }
});

/* SERVER */
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "0.0.0.0";

import os from "os";
import { ensureDefaults } from "./services/bootstrapService";

try {
  const server = app.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    const nets = os.networkInterfaces();
    console.log("Network interfaces:");
    Object.entries(nets).forEach(([name, addrs]) => {
      if (!addrs) return;
      addrs.forEach((addr) => {
        console.log(`  ${name} - ${addr.address} (${addr.family})${addr.internal ? ' internal' : ''}`);
      });
    });
    // Bootstrap defaults for first-run UX
    ensureDefaults().catch((err) => console.warn("Bootstrap ensureDefaults failed:", err));
  });

  // On unexpected errors, log and exit
  server.on("error", (err: any) => {
    console.error("Server error:", err);
    process.exit(1);
  });
} catch (err) {
  console.error("Failed to start server:", err);
  process.exit(1);
}

/* Diagnostic handlers to help discover why the process may exit */
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

process.on('exit', (code) => {
  console.log('process.exit event, code =', code);
});

// Diagnostic: log PID and listen for OS signals so we can tell if something external is killing the process
console.log('Process PID:', process.pid);

process.on('SIGINT', () => {
  console.log('Received SIGINT');
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM');
});

process.on('SIGHUP', () => {
  console.log('Received SIGHUP');
});

// Keep-alive logger to show the process remains alive; logs every 10s
setInterval(() => {
  console.log('keep-alive tick', new Date().toISOString());
}, 10_000);

// Ensure admin user exists and is configured properly at startup (only if env is set)
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  ensureAdminUser();
} else {
  console.log("Server: ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin bootstrap.");
}
