# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM oven/bun:1.2.21-alpine AS deps
WORKDIR /app

# Copy only package files needed for migrations
COPY package.json bun.lock turbo.json ./
COPY apps/db/package.json ./apps/db/package.json

# Install minimal dependencies in one layer
RUN bun install --omit dev --ignore-scripts && \
    bun install --omit dev --ignore-scripts drizzle-kit drizzle-orm postgres

# ========================================
# Runner Stage: Production Environment
# ========================================
FROM oven/bun:1.2.21-alpine AS runner
WORKDIR /app

# Copy only the necessary files from deps
COPY --from=deps /app/node_modules ./node_modules
COPY apps/db/drizzle.config.ts ./apps/db/drizzle.config.ts
COPY apps/db ./apps/db

WORKDIR /app/apps/db