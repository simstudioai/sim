# ========================================
# Base Stage: Alpine Linux with Bun
# ========================================
FROM oven/bun:1.4.4-alpine AS base

# ========================================
# Pruner Stage: Emit the monorepo subset @sim/db needs
# ========================================
FROM base AS pruner
WORKDIR /app

COPY . .

# out/ keeps @sim/db's development toolchain for the dev target's `db:push`;
# production/ narrows a copy to what `db:migrate` runs (see scripts/prune-production-workspace.ts).
RUN TURBO_VERSION="$(bun -e "console.log(require('./package.json').devDependencies.turbo)")" && \
    bunx --bun "turbo@${TURBO_VERSION}" prune @sim/db --docker && \
    cp -R out production && \
    bun scripts/prune-production-workspace.ts @sim/db production/full production/json

# ========================================
# Dependencies Stages
# ========================================
# Neither install is --frozen-lockfile: each holds a subset of the workspace, so
# Bun normalizes the pruned lockfile to it while keeping every locked resolution.
# Full-repository CI owns frozen-lockfile validation.
FROM base AS dev-deps
WORKDIR /app

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/bun.lock ./bun.lock

RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --linker=hoisted --ignore-scripts

FROM base AS deps
WORKDIR /app

COPY --from=pruner /app/production/json/ ./
COPY --from=pruner /app/production/bun.lock ./bun.lock

RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --linker=hoisted --omit=dev --ignore-scripts

FROM base AS user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# ========================================
# Dev Stage: also runs `db:push`, which needs drizzle-kit
# ========================================
FROM user AS dev
WORKDIR /app

COPY --from=dev-deps --chown=nextjs:nodejs /app ./
COPY --from=pruner --chown=nextjs:nodejs /app/out/full/ ./

USER nextjs
WORKDIR /app/packages/db

# ========================================
# Runner Stage (default): runs `db:migrate` with runtime dependencies only
# ========================================
FROM user AS runner
WORKDIR /app

COPY --from=deps --chown=nextjs:nodejs /app ./
COPY --from=pruner --chown=nextjs:nodejs /app/production/full/ ./

USER nextjs
WORKDIR /app/packages/db
