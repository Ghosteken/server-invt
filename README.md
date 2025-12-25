# StockStudio Server

This repository contains the backend API for the StockStudio SaaS platform. It is a robust, scalable, and secure RESTful API built with Node.js, Express, and Prisma, designed to handle complex business logic for inventory, sales, and multi-tenant management.

## 🚀 Tech Stack

- **Runtime:** [Node.js](https://nodejs.org/)
- **Framework:** [Express.js](https://expressjs.com/)
- **ORM:** [Prisma](https://www.prisma.io/)
- **Database:** [PostgreSQL](https://www.postgresql.org/)
- **Authentication:** JWT (JSON Web Tokens)
- **API Documentation:** [Swagger UI](https://swagger.io/tools/swagger-ui/)
- **Language:** TypeScript

## ✨ Key Features

- **RESTful API:** Structured endpoints for all application resources.
- **Authentication & Security:** Secure user authentication using JWT and role-based access control (RBAC).
- **Multi-Tenancy:** Built-in support for multiple tenants (organizations) with data isolation.
- **Data Management:** Efficient handling of products, inventory, sales, and purchases.
- **Reporting:** Advanced query capabilities for generating financial and operational reports.
- **File Handling:** Support for Excel import/export and PDF generation.

## 🛠️ Installation & Setup

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL Database
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

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add your database connection string and other secrets:
    ```env
    DATABASE_URL="postgresql://user:password@localhost:5432/stockstudio?schema=public"
    PORT=8000
    # Add other necessary variables
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

6.  **Start the Server:**
    ```bash
    npm run dev
    ```
    The server will start at `http://localhost:8000` (or your configured port).

## 📚 API Documentation

Once the server is running, you can access the interactive API documentation via Swagger UI at:
`http://localhost:8000/api-docs` (Check your specific route configuration if different).

## 🏗️ Project Structure

```
server/
├── prisma/             # Prisma schema and migrations
├── src/
│   ├── controllers/    # Request handlers
│   ├── routes/         # API route definitions
│   ├── middleware/     # Custom middleware (Auth, Error handling)
│   ├── services/       # Business logic layer
│   └── index.ts        # Application entry point
├── dist/               # Compiled JavaScript files
└── package.json        # Project dependencies and scripts
```

## 📜 Scripts

- `npm run dev`: Starts the server in development mode with hot-reloading.
- `npm run build`: Compiles TypeScript code to JavaScript.
- `npm start`: Runs the compiled application in production mode.
- `npm run lint`: Runs ESLint.
- `npm run prisma:generate`: Generates the Prisma client.
- `npm run prisma:migrate`: Applies database migrations.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
