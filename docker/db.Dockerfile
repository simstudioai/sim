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

# Copy only the necessary files from deps
COPY --from=deps /app/node_modules ./node_modules
COPY packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY packages/db ./packages/db

WORKDIR /app/packages/db