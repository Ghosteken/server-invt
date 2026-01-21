"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
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
const purchasesRoutes_1 = __importDefault(require("./routes/purchasesRoutes"));
const invoiceRoutes_1 = __importDefault(require("./routes/invoiceRoutes"));
const salesAgentRoutes_1 = __importDefault(require("./routes/salesAgentRoutes"));
const locationRoutes_1 = __importDefault(require("./routes/locationRoutes"));
const contactRoutes_1 = __importDefault(require("./routes/contactRoutes"));
const errorMiddleware_1 = require("./middleware/errorMiddleware");
function createApp() {
    dotenv_1.default.config();
    const app = (0, express_1.default)();
    // Core middleware
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
    const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map(origin => origin.trim());
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            console.log(`Express CORS Check: Origin=${origin}, Allowed=${JSON.stringify(allowedOrigins)}`);
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                console.error(`Express CORS Blocked: Origin=${origin}`);
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
    }));
    // Rate limiter; configurable via env
    const ipFromReq = (req) => {
        const xf = req.headers?.["x-forwarded-for"];
        const forwarded = Array.isArray(xf) ? xf[0] : xf;
        const raw = req.ip || forwarded || req.socket?.remoteAddress || "";
        const s = String(raw || "");
        return s.startsWith("::ffff:") ? s.slice(7) : (s || "unknown");
    };
    const limiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: Number(process.env.RATE_LIMIT_MAX || 300),
        keyGenerator: (req) => {
            const tid = req.tenantId || req.user?.tenantId || "default";
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
        }
        catch {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
        }
        next();
    });
    // Static files
    app.use('/assets', express_1.default.static(path_1.default.join(__dirname, '../public/assets')));
    // Routes - API v1
    const apiRouter = express_1.default.Router();
    apiRouter.use("/auth", authRoutes_1.default);
    apiRouter.use("/dashboard", dashboardRoutes_1.default);
    apiRouter.use("/products", productRoutes_1.default);
    apiRouter.use("/users", userRoutes_1.default);
    apiRouter.use("/expenses", expenseRoutes_1.default);
    apiRouter.use("/notifications", notificationRoutes_1.default);
    apiRouter.use("/customers", customerRoutes_1.default);
    apiRouter.use("/reports", reportRoutes_1.default);
    apiRouter.use("/settings", require("./routes/settingsRoutes").default);
    apiRouter.use("/store-sales", storeSalesRoutes_1.default);
    apiRouter.use("/stores", storesRoutes_1.default);
    apiRouter.use("/purchases", purchasesRoutes_1.default);
    apiRouter.use("/statements", require("./routes/statementsRoutes").default);
    apiRouter.use("/invoices", invoiceRoutes_1.default);
    apiRouter.use("/sales-agents", salesAgentRoutes_1.default);
    apiRouter.use("/locations", locationRoutes_1.default);
    apiRouter.use("/contact", contactRoutes_1.default);
    // Mount API v1
    app.use("/api/v1", apiRouter);
    // Legacy support (optional, can be removed later)
    app.use("/", apiRouter);
    // Global error handler - MUST be after all routes
    app.use(errorMiddleware_1.globalErrorHandler);
    return app;
}
exports.default = createApp;
