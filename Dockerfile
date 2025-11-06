FROM node:18-alpine
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate || true

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Copy and use entrypoint to run migrations before starting
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]