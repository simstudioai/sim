# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.2.22-alpine AS base

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
WORKDIR /app

# Copy only package files needed for migrations (these change less frequently)
COPY package.json bun.lock turbo.json ./
RUN mkdir -p packages/db
COPY packages/db/package.json ./packages/db/package.json

# Install dependencies (this layer will be cached if package files don't change)
RUN bun install --ignore-scripts

# ========================================
# Runner Stage: Production Environment
# ========================================
FROM base AS runner
WORKDIR /app

# Create non-root user and group (cached separately)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy only the necessary files from deps (cached if dependencies don't change)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy package configuration files (needed for migrations)
COPY --chown=nextjs:nodejs packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts

# Copy database package source code (changes most frequently - placed last)
COPY --chown=nextjs:nodejs packages/db ./packages/db

# Switch to non-root user
USER nextjs

WORKDIR /app/packages/db