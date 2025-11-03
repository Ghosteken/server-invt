import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
/* ROUTE IMPORTS */
import dashboardRoutes from "./routes/dashboardRoutes";
import productRoutes from "./routes/productRoutes";
import userRoutes from "./routes/userRoutes";
import expenseRoutes from "./routes/expenseRoutes";
import authRoutes from "./routes/authRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import { ensureAdminUser } from "./services/adminBootstrap";

/* CONFIGURATIONS */
dotenv.config();
const app = express();
app.use(express.json());
app.use(helmet());
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(morgan("common"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

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

/* SERVER */
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "127.0.0.1";

import os from "os";

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
}, 1000);

// Ensure admin user exists and is configured properly at startup
ensureAdminUser();
