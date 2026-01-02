# Stock Studio Server

Backend API for Stock Studio — a multi-tenant, inventory, sales, and purchasing platform. The server is built with Node.js, Express, and Prisma on PostgreSQL, featuring Redis-backed caching, rate limiting, secure JWT auth, and tenant-scoped data isolation.

## 🚀 Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Auth:** JWT (JSON Web Tokens)
- **Caching:** Redis (Upstash-compatible) with in-memory fallback
- **Rate Limiting:** express-rate-limit (tenant/user/IP-aware)
- **Docs:** Swagger UI (optional)
- **Realtime:** Socket.IO (dashboard refresh notifications)

## ✨ Key Features

- **Multi-tenant isolation:** All reads/writes scoped per `tenantId` (derived from `x-tenant-id` header or JWT).
- **Authentication & RBAC:** Secure JWT auth with role-based access; org-admin and admin flows.
- **Inventory, Invoices, Purchases:** Full CRUD and business logic for CTN/PCS units, payments, and supplier metadata.
- **Reporting & Dashboard:** Cached aggregates for KPIs, top customers, low stock, dead stock, and expiring products.
- **Rate limiting:** Configurable per-minute thresholds, keyed by `tenantId` + `userId` or IP.
- **Caching & performance:** Redis-backed cache with TTLs plus `Cache-Control` headers for public responses.
- **Realtime notifications:** Socket.IO emits `dashboard:refresh` for client cache invalidation.
- **Import/Export:** CSV/Excel support via `xlsx`; PDFs via `pdf-parse` when needed.

## 🛠️ Installation & Setup

### Prerequisites

- Node.js (v18+)
- PostgreSQL
- npm or yarn

### Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd server
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure environment variables:** Create `.env` in `server/`.
    
    Required:
    
    ```env
    DATABASE_URL="postgresql://user:password@localhost:5432/stockstudio?schema=public"
    JWT_SECRET="change-me"
    PORT=3001
    HOST=0.0.0.0
    
    # Rate limiting (per 60s window)
    RATE_LIMIT_MAX=300
    
    # Dashboard/low-stock defaults
    LOW_STOCK_THRESHOLD=5
    
    # Redis (choose one): standard URL OR Upstash REST credentials
    # REDIS_URL=rediss://default:<token>@<host>:6379
    # UPSTASH_REDIS_REST_URL=https://<your-upstash-host>
    # UPSTASH_REDIS_REST_TOKEN=<your-upstash-token>
    
    # Optional convenience
    # ADMIN_EMAIL="admin@example.com"          # elevates matching user to admin
    # MASTER_ADMIN_EMAIL="admin@example.com"   # master admin bypass in verify
    ```

4.  **Run Database Migrations:**
    Initialize the database schema using Prisma:
    ```bash
    npx prisma migrate dev
    ```

5.  **Seed the Database (Optional):**
    Populate the database with initial data:
    ```bash
    npm run prisma:seed
    ```

6.  **Start the server:**
    ```bash
    npm run dev
    ```
    Default: http://localhost:3001

## 📚 API Documentation

If `swagger/swagger.yaml` exists, Swagger UI is served at `/docs`.
Example: http://localhost:3001/docs

## 🏗️ Project Structure

```
server/
├── prisma/              # Schema, migrations, seed data
├── src/
│   ├── controllers/     # Route handlers (e.g., dashboardController)
│   ├── routes/          # API routes (e.g., dashboardRoutes, invoiceRoutes)
│   ├── services/        # Business services (cache, pcsInventory, notifications)
│   ├── db/              # Prisma client
│   ├── swagger/         # swagger.yaml (optional)
│   ├── app.ts           # Express app factory with rate limiting
│   └── index.ts         # Main server (Socket.IO, Swagger, health/status)
└── package.json
```

Key files:
- [src/app.ts](src/app.ts): global security headers, gzip, rate limiting with tenant-aware keying.
- [src/index.ts](src/index.ts): main server, Socket.IO setup, `/docs` route.
- [src/services/cache.ts](src/services/cache.ts): Redis + memory TTL cache helpers.
- [src/controllers/dashboardController.ts](src/controllers/dashboardController.ts): cached KPIs and `Cache-Control` headers.
- [src/db/prisma.ts](src/db/prisma.ts): singleton Prisma client.

## 📜 Scripts

- `npm run dev`: start dev server (ts-node + nodemon)
- `npm run build`: compile TypeScript => `dist/`
- `npm start`: run compiled server
- `npm test`: run Jest tests
- `npm run lint`: ESLint
- `npm run typecheck`: TypeScript `--noEmit`
- `npm run prisma:generate`: Prisma client
- `npm run prisma:migrate`: Prisma migrate dev
- `npm run prisma:seed`: Prisma DB seed

## 🔒 Security & Tenancy
- **Helmet + HSTS (prod):** Secure defaults, CSP, CORP.
- **CORS:** Enabled; restrict origins in production.
- **JWT:** Tokens signed with `JWT_SECRET`. `verify` route validates and returns user.
- **Tenant resolution:**
    - Prefer `x-tenant-id` header (set by client).
    - Fallback: decode `tenantId` from JWT.
    - Default: `"default"`.

## 🛡️ Rate Limiting
- **Library:** `express-rate-limit`.
- **Window:** 60 seconds.
- **Max:** `RATE_LIMIT_MAX` (default 300).
- **Keying:** Combines `tenantId` and `userId` if present; else tenant + IP.
- **Skip rule:** Example skip for some GET endpoints (see [src/index.ts](src/index.ts)).

## ⚡ Caching & Performance
- **Service:** [src/services/cache.ts](src/services/cache.ts)
    - Tries Redis first (`REDIS_URL`) or auto-constructs from Upstash REST creds.
    - Falls back to in-memory `Map` with TTL.
- **Helpers:** `cacheGet`, `cacheSet`, `withCache(key, ttl, loader)`.
- **HTTP caching:** Controllers set `Cache-Control` (e.g., dashboard `max-age=60`, lists `max-age=30`).

## 🔌 Realtime
- **Socket.IO:** Server broadcasts `dashboard:refresh` events; clients invalidate RTK Query caches.

## 🔎 Core Endpoints (examples)
- `/auth/*`: login, verify, org admin, signup org.
- `/dashboard/*`: metrics, low-stock, expiring, dead-stock, top-customers.
- `/products/*`: CRUD, search, CTN stock handling.
- `/purchases/*`: create, supplier meta, payments.
- `/invoices/*`: create/update, items, payments, layouts.
- `/customers/*`: directory, groups, statements.
- `/expenses/*`: create/update, approvals, summaries.
- `/stores/*`, `/store-sales/*`, `/locations/*`, `/sales-agents/*`: multi-branch operations.
- `/reports/*`: sales, purchases, financial.

## 🧪 Testing
- **Unit/Integration:** Jest + Supertest (see `src/__tests__`).
- **Cache & rate limit:** Dedicated tests for TTL caching and 429 behavior.

## 🤝 Contributing
Pull requests welcome. Please run lint and tests before submitting.

## 📄 License
MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
