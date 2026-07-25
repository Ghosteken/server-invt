FROM node:18-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy Prisma schema and generate client.
# Demo deployment (default): no external Postgres database — generate
# against the bundled SQLite schema instead. To build against real
# Postgres/schema.prisma, pass --build-arg DEMO_MODE=false.
ARG DEMO_MODE=true
COPY prisma ./prisma
RUN if [ "$DEMO_MODE" = "true" ]; then \
      npx prisma generate --schema=prisma/schema.demo.prisma; \
    else \
      npx prisma generate; \
    fi

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV PORT=3001
ENV DEMO_MODE=${DEMO_MODE}
# Only used when DEMO_MODE=true; ignored (and required to be set for real
# Postgres) otherwise. Relative to the prisma/ directory, not the app root.
ENV DATABASE_URL=file:./demo.db
EXPOSE 3001

# Entrypoint
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
