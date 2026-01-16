import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import compression from "compression";
import rateLimit from "express-rate-limit";
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
import purchasesRoutes from "./routes/purchasesRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";
import salesAgentRoutes from "./routes/salesAgentRoutes";
import locationRoutes from "./routes/locationRoutes";
import contactRoutes from "./routes/contactRoutes";
import { globalErrorHandler } from "./middleware/errorMiddleware";

export function createApp() {
  dotenv.config();
  const app = express();
  // Core middleware
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
  
  const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map(origin => origin.trim());
  app.use(cors({
    origin: (origin, callback) => {
      console.log(`Express CORS Check: Origin=${origin}, Allowed=${JSON.stringify(allowedOrigins)}`);
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`Express CORS Blocked: Origin=${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }));

  // Rate limiter; configurable via env
  const ipFromReq = (req: any): string => {
    const xf = req.headers?.["x-forwarded-for"];
    const forwarded = Array.isArray(xf) ? xf[0] : xf;
    const raw = req.ip || forwarded || req.socket?.remoteAddress || "";
    const s = String(raw || "");
    return s.startsWith("::ffff:") ? s.slice(7) : (s || "unknown");
  };
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    keyGenerator: (req) => {
      const tid = (req as any).tenantId || req.user?.tenantId || "default";
      const uid = req.user?.userId;
      return uid ? `${tid}:${uid}` : `${tid}:${ipFromReq(req)}`;
    },
  });
  app.use(limiter);

  // Simple request logger for debugging
  app.use((req, res, next) => {
    try {
      const safeBody = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${safeBody}`);
    } catch {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
    }
    next();
  });

  // Static files
  app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

  // Routes - API v1
  const apiRouter = express.Router();
  apiRouter.use("/auth", authRoutes);
  apiRouter.use("/dashboard", dashboardRoutes);
  apiRouter.use("/products", productRoutes);
  apiRouter.use("/users", userRoutes);
  apiRouter.use("/expenses", expenseRoutes);
  apiRouter.use("/notifications", notificationRoutes);
  apiRouter.use("/customers", customerRoutes);
  apiRouter.use("/reports", reportRoutes);
  apiRouter.use("/settings", require("./routes/settingsRoutes").default);
  apiRouter.use("/store-sales", storeSalesRoutes);
  apiRouter.use("/stores", storesRoutes);
  apiRouter.use("/purchases", purchasesRoutes);
  apiRouter.use("/statements", require("./routes/statementsRoutes").default);
  apiRouter.use("/invoices", invoiceRoutes);
  apiRouter.use("/sales-agents", salesAgentRoutes);
  apiRouter.use("/locations", locationRoutes);
  apiRouter.use("/contact", contactRoutes);

  // Mount API v1
  app.use("/api/v1", apiRouter);

  // Legacy support (optional, can be removed later)
  app.use("/", apiRouter);

  // Global error handler - MUST be after all routes
  app.use(globalErrorHandler);

  return app;
}

export default createApp;
