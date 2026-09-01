# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.3.14-alpine AS base

RUN apk add --no-cache libc6-compat curl

# ========================================
# Pruner Stage: Emit a minimal monorepo subset that @sim/realtime depends on
# ========================================
FROM base AS pruner
WORKDIR /app

COPY . .

RUN TURBO_VERSION="$(bun -e "console.log(require('./package.json').devDependencies.turbo)")" && \
    bunx --bun "turbo@${TURBO_VERSION}" prune @sim/realtime --docker

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
WORKDIR /app

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock

# turbo prune emits a bun.lock that bun 1.3.x rejects under --frozen-lockfile
# ("Failed to resolve prod dependency"). Bun must be allowed to normalize that
# lockfile to the pruned graph; the full-repository CI install owns
# frozen-lockfile validation.
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --linker=hoisted --omit=dev --ignore-scripts

# ========================================
# Runner Stage: Run the Socket Server
# ========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3002 \
    HOSTNAME="0.0.0.0"

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

COPY --from=deps --chown=nextjs:nodejs /app ./
COPY --from=pruner --chown=nextjs:nodejs /app/out/full/ ./

USER nextjs

EXPOSE 3002

CMD ["bun", "apps/realtime/src/bootstrap.ts"]
