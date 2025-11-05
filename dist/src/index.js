"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
/* ROUTE IMPORTS */
const dashboardRoutes_1 = __importDefault(require("./routes/dashboardRoutes"));
const productRoutes_1 = __importDefault(require("./routes/productRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const expenseRoutes_1 = __importDefault(require("./routes/expenseRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const customerRoutes_1 = __importDefault(require("./routes/customerRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const adminBootstrap_1 = require("./services/adminBootstrap");
/* CONFIGURATIONS */
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, helmet_1.default)());
app.use(helmet_1.default.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use((0, morgan_1.default)("common"));
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: false }));
app.use((0, cors_1.default)());
// Simple request logger that prints method, url and body for debugging
app.use((req, res, next) => {
    try {
        const safeBody = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: ${safeBody}`);
    }
    catch (e) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - body: <unserializable>`);
    }
    next();
});
/* STATIC FILES */
app.use('/assets', express_1.default.static(path_1.default.join(__dirname, '../public/assets')));
/* ROUTES */
app.use("/auth", authRoutes_1.default); // http://localhost:8000/auth
app.use("/dashboard", dashboardRoutes_1.default); // http://localhost:8000/dashboard
app.use("/products", productRoutes_1.default); // http://localhost:8000/products
app.use("/users", userRoutes_1.default); // http://localhost:8000/users
app.use("/expenses", expenseRoutes_1.default); // http://localhost:8000/expenses
app.use("/notifications", notificationRoutes_1.default); // http://localhost:8000/notifications
app.use("/customers", customerRoutes_1.default); // http://localhost:8000/customers
app.use("/reports", reportRoutes_1.default); // http://localhost:8000/reports
/* SERVER */
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || "127.0.0.1";
const os_1 = __importDefault(require("os"));
try {
    const server = app.listen(port, host, () => {
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
}, 1000);
// Ensure admin user exists and is configured properly at startup (only if env is set)
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    (0, adminBootstrap_1.ensureAdminUser)();
}
else {
    console.log("Server: ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin bootstrap.");
}
