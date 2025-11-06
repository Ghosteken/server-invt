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
import purchasesRoutes from "./routes/purchasesRoutes";

export function createApp() {
  dotenv.config();
  const app = express();
  // Core middleware
  app.use(compression());
  app.use(express.json());
  app.use(helmet());
  app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
  app.use(morgan("common"));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(cors());

  // Rate limiter; configurable via env
  const limiter = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.RATE_LIMIT_MAX || 300) });
  app.use(limiter);

  // Simple request logger for debugging
  app.use((req, res, next) => {
    try {
      const safeBody = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${safeBody}`);
    } catch (e) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
    }
    next();
  });

  // Static files
  app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

  // Routes
  app.use("/auth", authRoutes);
  app.use("/dashboard", dashboardRoutes);
  app.use("/products", productRoutes);
  app.use("/users", userRoutes);
  app.use("/expenses", expenseRoutes);
  app.use("/notifications", notificationRoutes);
  app.use("/customers", customerRoutes);
  app.use("/reports", reportRoutes);
  app.use("/settings", require("./routes/settingsRoutes").default);
  app.use("/store-sales", storeSalesRoutes);
  app.use("/purchases", purchasesRoutes);

  return app;
}

export default createApp;