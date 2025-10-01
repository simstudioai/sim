# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:alpine AS base

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install turbo globally
RUN bun install -g turbo

COPY package.json bun.lock ./
RUN mkdir -p apps
COPY apps/sim/package.json ./apps/sim/package.json

RUN bun install --omit dev --ignore-scripts

# ========================================
# Builder Stage: Build the Application
# ========================================
FROM base AS builder
WORKDIR /app

# Install turbo globally in builder stage
RUN bun install -g turbo

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Installing with full context to prevent missing dependencies error
RUN bun install --omit dev --ignore-scripts

# Required for standalone nextjs build
WORKDIR /app/apps/sim
RUN bun install sharp

ENV NEXT_TELEMETRY_DISABLED=1 \
    VERCEL_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1

WORKDIR /app

# Provide dummy database URLs during image build so server code that imports @sim/db
# can be evaluated without crashing. Runtime environments should override these.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}

RUN bun run build

# ========================================
# Runner Stage: Run the actual app
# ========================================

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/apps/sim/public ./apps/sim/public
COPY --from=builder /app/apps/sim/.next/standalone ./
COPY --from=builder /app/apps/sim/.next/static ./apps/sim/.next/static

EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME="0.0.0.0"

CMD ["bun", "apps/sim/server.js"]