#!/bin/sh
set -e

if [ "$NODE_ENV" = "production" ]; then
  echo "🚫 Production detected. Skipping Prisma migrations!"
else
  echo "Running Prisma migrations..."
  npx prisma migrate deploy
fi

echo "Starting server..."
node dist/src/index.js
