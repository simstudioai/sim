# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM oven/bun:1.2.22-alpine AS deps
WORKDIR /app

# Copy only package files needed for migrations
COPY package.json bun.lock turbo.json ./
COPY packages/db/package.json ./packages/db/package.json

# Install dependencies
RUN bun install --ignore-scripts

# ========================================
# Runner Stage: Production Environment
# ========================================
FROM oven/bun:1.2.22-alpine AS runner
WORKDIR /app

# Create non-root user and group
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy only the necessary files from deps
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY --chown=nextjs:nodejs packages/db ./packages/db

# Switch to non-root user
USER nextjs

WORKDIR /app/packages/db