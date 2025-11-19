# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.2.22-alpine AS base

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install turbo globally (cached separately, changes infrequently)
RUN bun install -g turbo

COPY package.json bun.lock turbo.json ./
RUN mkdir -p apps packages/db
COPY apps/sim/package.json ./apps/sim/package.json
COPY packages/db/package.json ./packages/db/package.json

# Install dependencies (this layer will be cached if package files don't change)
RUN bun install --omit dev --ignore-scripts

# ========================================
# Builder Stage: Prepare source code
# ========================================
FROM base AS builder
WORKDIR /app

# Copy node_modules from deps stage (cached if dependencies don't change)
COPY --from=deps /app/node_modules ./node_modules

# Copy package configuration files (needed for build)
COPY package.json bun.lock turbo.json ./
COPY apps/sim/package.json ./apps/sim/package.json
COPY packages/db/package.json ./packages/db/package.json

# Copy source code (changes most frequently - placed last to maximize cache hits)
COPY apps/sim ./apps/sim
COPY packages ./packages

# ========================================
# Runner Stage: Run the Socket Server
# ========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user and group (cached separately)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy package.json first (changes less frequently)
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy node_modules from builder (cached if dependencies don't change)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy db package (needed by socket-server)
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db

# Copy sim app (changes most frequently - placed last)
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim ./apps/sim

# Switch to non-root user
USER nextjs

# Expose socket server port (default 3002, but configurable via PORT env var)
EXPOSE 3002
ENV PORT=3002 \
    SOCKET_PORT=3002 \
    HOSTNAME="0.0.0.0"

# Run the socket server directly
CMD ["bun", "apps/sim/socket-server/index.ts"]