"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const zod_1 = require("zod");
const crypto_1 = require("crypto");
const dotenv_1 = __importDefault(require("dotenv"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const compression_1 = __importDefault(require("compression"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = __importDefault(require("./db/prisma"));
/* ROUTE IMPORTS */
const dashboardRoutes_1 = __importDefault(require("./routes/dashboardRoutes"));
const productRoutes_1 = __importDefault(require("./routes/productRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const expenseRoutes_1 = __importDefault(require("./routes/expenseRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const customerRoutes_1 = __importDefault(require("./routes/customerRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const storeSalesRoutes_1 = __importDefault(require("./routes/storeSalesRoutes"));
const storesRoutes_1 = __importDefault(require("./routes/storesRoutes"));
const adminBootstrap_1 = require("./services/adminBootstrap");
const legacyCleanup_1 = require("./services/legacyCleanup");
const settingsRoutes_1 = __importDefault(require("./routes/settingsRoutes"));
const purchasesRoutes_1 = __importDefault(require("./routes/purchasesRoutes"));
const invoiceRoutes_1 = __importDefault(require("./routes/invoiceRoutes"));
const salesAgentRoutes_1 = __importDefault(require("./routes/salesAgentRoutes"));
const locationRoutes_1 = __importDefault(require("./routes/locationRoutes"));
const contactRoutes_1 = __importDefault(require("./routes/contactRoutes"));
const superAdminRoutes_1 = __importDefault(require("./routes/superAdminRoutes"));
const aiRoutes_1 = __importDefault(require("./routes/aiRoutes"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const yamljs_1 = __importDefault(require("yamljs"));
/* CONFIGURATIONS */
dotenv_1.default.config();
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map(origin => origin.trim());
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            console.log(`SocketIO CORS Check: Origin=${origin}, Allowed=${JSON.stringify(allowedOrigins)}`);
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                console.error(`SocketIO CORS Blocked: Origin=${origin}`);
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});
app.set("io", io);
// Enable gzip compression (Brotli is handled by proxies/CDNs if present)
app.use((0, compression_1.default)());
app.use(express_1.default.json());
app.use((0, helmet_1.default)());
app.use(helmet_1.default.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(helmet_1.default.contentSecurityPolicy({
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
    app.use(helmet_1.default.hsts({ maxAge: 63072000 }));
}
app.use((0, morgan_1.default)("common"));
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: false }));
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
}));
// Resolve tenant for isolation: prefer 'x-tenant-id' header; else derive from JWT if present
app.use((req, _res, next) => {
    try {
        const headerTenant = String((req.headers["x-tenant-id"] || "")).trim();
        if (headerTenant) {
            req.tenantId = headerTenant;
            next();
            return;
        }
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(" ")[1];
        if (token) {
            const decoded = jsonwebtoken_1.default.decode(token);
            if (decoded && decoded.tenantId) {
                req.tenantId = decoded.tenantId;
            }
        }
    }
    catch { }
    next();
});
// Basic rate limiting to protect hot endpoints
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    skip: (req) => req.method === 'GET' && req.path.startsWith('/users'),
});
app.use(limiter);
// Simple request logger disabled for performance
// app.use((req, res, next) => {
//   try {
//     const safeBody = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${safeBody}`);
//   } catch (e) {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
//   }
//   next();
// });
/* STATIC FILES */
app.use('/assets', express_1.default.static(path_1.default.join(__dirname, '../public/assets')));
/* ROUTES */
const apiRouter = express_1.default.Router();
apiRouter.use("/auth", authRoutes_1.default);
apiRouter.use("/dashboard", dashboardRoutes_1.default);
apiRouter.use("/products", productRoutes_1.default);
apiRouter.use("/users", userRoutes_1.default);
apiRouter.use("/expenses", expenseRoutes_1.default);
apiRouter.use("/notifications", notificationRoutes_1.default);
apiRouter.use("/customers", customerRoutes_1.default);
apiRouter.use("/reports", reportRoutes_1.default);
apiRouter.use("/settings", settingsRoutes_1.default);
apiRouter.use("/store-sales", storeSalesRoutes_1.default);
apiRouter.use("/stores", storesRoutes_1.default);
apiRouter.use("/invoices", invoiceRoutes_1.default);
apiRouter.use("/purchases", purchasesRoutes_1.default);
apiRouter.use("/sales-agents", salesAgentRoutes_1.default);
apiRouter.use("/locations", locationRoutes_1.default);
apiRouter.use("/contact", contactRoutes_1.default);
apiRouter.use("/super-admin", superAdminRoutes_1.default);
apiRouter.use("/ai", aiRoutes_1.default);
// Mount API v1
app.use("/api/v1", apiRouter);
// Fallback for /api prefix (common default)
app.use("/api", apiRouter);
// Legacy support (optional, can be removed later)
app.use("/", apiRouter);
try {
    const swaggerDocument = yamljs_1.default.load(path_1.default.join(__dirname, "swagger/swagger.yaml"));
    app.use("/docs", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerDocument));
}
catch (e) {
    console.warn("Swagger YAML not found or invalid; /docs disabled");
}
app.get("/health", async (_req, res) => {
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        res.json({ status: "ok", db: "ok", time: new Date().toISOString() });
    }
    catch (err) {
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
        const Body = zod_1.z.object({ subject: zod_1.z.string().min(1), body: zod_1.z.string().min(1) });
        const { subject, body } = Body.parse(req.body || {});
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const created = await prisma_1.default.supportMessages.create({ data: { id: (0, crypto_1.randomUUID)(), tenantId, userId: req.user?.userId || null, subject, body } });
        res.status(201).json(created);
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to create support message" });
    }
});
app.get("/support/messages", async (req, res) => {
    try {
        const Query = zod_1.z.object({ status: zod_1.z.string().optional() });
        const { status } = Query.parse(req.query);
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const messages = await prisma_1.default.supportMessages.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" } });
        res.json({ messages });
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to read support messages" });
    }
});
app.put("/support/messages/:id/status", async (req, res) => {
    try {
        const Params = zod_1.z.object({ id: zod_1.z.string().min(1) });
        const { id } = Params.parse(req.params);
        const Body = zod_1.z.object({ status: zod_1.z.enum(["open", "pending", "closed"]) });
        const { status } = Body.parse(req.body || {});
        const tenantId = req.tenantId || req.user?.tenantId || "default";
        const existing = await prisma_1.default.supportMessages.findUnique({ where: { id } });
        if (!existing || existing.tenantId !== tenantId) {
            res.status(404).json({ message: "Message not found" });
            return;
        }
        const updated = await prisma_1.default.supportMessages.update({ where: { id }, data: { status } });
        res.json(updated);
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            res.status(400).json({ message: "Invalid input", errors: err.issues });
            return;
        }
        res.status(500).json({ message: "Failed to update message status" });
    }
});
/* SERVER */
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "0.0.0.0";
const os_1 = __importDefault(require("os"));
const bootstrapService_1 = require("./services/bootstrapService");
try {
    const server = httpServer.listen(port, host, () => {
        console.log(`Server running on ${host}:${port}`);
        const nets = os_1.default.networkInterfaces();
        console.log("Network interfaces:");
        Object.entries(nets).forEach(([name, addrs]) => {
            if (!addrs)
                return;
            addrs.forEach((addr) => {
                console.log(`  ${name} - ${addr.address} (${addr.family})${addr.internal ? ' internal' : ''}`);
            });
        });
        // Bootstrap defaults for first-run UX
        (0, bootstrapService_1.ensureDefaults)().catch((err) => console.warn("Bootstrap ensureDefaults failed:", err));
        // One-time cleanup of legacy hardcoded admin account, before any syncing
        (0, legacyCleanup_1.purgeDefaultAdminEmail)().catch((err) => console.warn("Bootstrap purgeDefaultAdminEmail failed:", err));
        // Sync org admins to Users so admin appears in tenant-scoped views
        (0, adminBootstrap_1.syncOrgAdminsToUsers)().catch((err) => console.warn("Bootstrap syncOrgAdminsToUsers failed:", err));
    });
    // On unexpected errors, log and exit
    server.on("error", (err) => {
        console.error("Server error:", err);
        process.exit(1);
    });
}
catch (err) {
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
}, 10000);
