# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.4.4-alpine AS base

RUN apk add --no-cache libc6-compat curl

# ========================================
# Pruner Stage: Emit the monorepo subset @sim/realtime runs in production
# ========================================
FROM base AS pruner
WORKDIR /app

COPY . .

# turbo keeps the workspace members @sim/realtime needs to build and test too;
# scripts/prune-production-workspace.ts drops those and their devDependencies.
RUN TURBO_VERSION="$(bun -e "console.log(require('./package.json').devDependencies.turbo)")" && \
    bunx --bun "turbo@${TURBO_VERSION}" prune @sim/realtime --docker && \
    bun scripts/prune-production-workspace.ts @sim/realtime out/full out/json

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
WORKDIR /app

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock

# Not --frozen-lockfile: the narrowed manifests no longer match the pruned
# lockfile. Bun keeps every locked resolution, and full-repository CI owns
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

# /tmp stays writable under a read-only root filesystem: ECS copies the image's
# /tmp (mode 1777) into a bind volume mounted at a VOLUME path.
RUN chmod 1777 /tmp
VOLUME ["/tmp"]

USER nextjs

EXPOSE 3002

CMD ["bun", "apps/realtime/src/bootstrap.ts"]
