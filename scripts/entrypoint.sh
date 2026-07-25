#!/bin/sh
set -e

if [ "$DEMO_MODE" = "true" ]; then
  echo "Demo mode: syncing bundled SQLite schema (no external database)..."
  npx prisma db push --schema=prisma/schema.demo.prisma --skip-generate --accept-data-loss
elif [ "$NODE_ENV" = "production" ]; then
  echo "🚫 Production detected. Skipping Prisma migrations!"
else
  echo "Running Prisma migrations..."
  npx prisma migrate deploy
fi

echo "Starting server..."
node dist/src/index.js
