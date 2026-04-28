# ========================================
# Base Stage: Debian-based Bun with Node.js 22
# ========================================
FROM oven/bun:1.3.13-slim AS base

# Install Node.js 22 and common dependencies once in base stage
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv make g++ curl ca-certificates bash ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# ========================================
# Pruner Stage: Emit a minimal monorepo subset that sim depends on
# ========================================
FROM base AS pruner
WORKDIR /app

RUN bun install -g turbo@2.9.6

COPY . .

RUN turbo prune sim --docker

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM base AS deps
WORKDIR /app

# Pruned manifests from the pruner stage. This layer only invalidates when
# package.json/bun.lock content changes — not on source edits.
COPY --from=pruner /app/out/json/ ./
# Use the full bun.lock (not the pruned out/bun.lock). turbo prune emits a
# bun.lock that bun 1.3.x rejects with "Failed to resolve prod dependency",
# forcing a slow fresh resolve. The full lockfile parses cleanly and bun
# only installs what the pruned package.jsons reference.
COPY --from=pruner /app/bun.lock ./bun.lock

# Install all dependencies (including devDependencies — tailwindcss/postcss are
# devDeps but required at build time). Then rebuild isolated-vm against Node.js.
# JOBS=4 caps node-gyp parallelism — higher values OOM isolated-vm (laverdet/isolated-vm#428).
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    --mount=type=cache,id=npm-cache,target=/root/.npm \
    HUSKY=0 bun install --ignore-scripts --linker=hoisted && \
    cd node_modules/isolated-vm && JOBS=4 npx node-gyp rebuild --release

# ========================================
# Builder Stage: Build the Application
# ========================================
FROM base AS builder
ARG TARGETPLATFORM
WORKDIR /app

# Copy node_modules from deps stage (cached if dependencies don't change)
COPY --from=deps /app/node_modules ./node_modules

# Copy pruned source tree (apps/sim + workspace packages it depends on)
COPY --from=pruner /app/out/full/ ./

# Next.js 16 / Turbopack workspace-root detection looks for a lockfile next to
# the workspace package.json. Without it, `next build` fails with
# "couldn't find next/package.json from /app/apps/sim". turbo also warns
# "Lockfile not found at /app/bun.lock" without it.
COPY --from=pruner /app/bun.lock ./bun.lock

ENV NEXT_TELEMETRY_DISABLED=1 \
    VERCEL_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1

# Provide dummy database URLs during image build so server code that imports @sim/db
# can be evaluated without crashing. Runtime environments should override these.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}

# Provide dummy NEXT_PUBLIC_APP_URL for build-time evaluation
# Runtime environments should override this with the actual URL
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Per-platform cache id keeps arm64/amd64 SWC artifacts isolated.
RUN --mount=type=cache,id=next-cache-${TARGETPLATFORM},target=/app/apps/sim/.next/cache \
    --mount=type=cache,id=turbo-cache-${TARGETPLATFORM},target=/app/.turbo \
    bun run build

# ========================================
# Runner Stage: Run the actual app
# ========================================

FROM base AS runner
WORKDIR /app

# Node.js 22, Python, ffmpeg, etc. are already installed in base stage
ENV NODE_ENV=production

# Create non-root user and group
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nextjs

# Copy application artifacts from builder
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/public ./apps/sim/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/.next/static ./apps/sim/.next/static

# Copy blog/author content for runtime filesystem reads (not part of the JS bundle)
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/content ./apps/sim/content

# Copy isolated-vm native module (compiled for Node.js in deps stage)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/isolated-vm ./node_modules/isolated-vm

# Copy the isolated-vm worker script
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/execution/isolated-vm-worker.cjs ./apps/sim/lib/execution/isolated-vm-worker.cjs

# Copy the pre-built sandbox library bundles (pptxgenjs, docx, pdf-lib) that
# run inside the V8 isolate. Committed into the repo; see
# apps/sim/lib/execution/sandbox/bundles/build.ts to regenerate.
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/execution/sandbox/bundles ./apps/sim/lib/execution/sandbox/bundles

# Guardrails setup with pip caching
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/guardrails/requirements.txt ./apps/sim/lib/guardrails/requirements.txt
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/guardrails/validate_pii.py ./apps/sim/lib/guardrails/validate_pii.py

# Install Python dependencies with pip cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv ./apps/sim/lib/guardrails/venv && \
    ./apps/sim/lib/guardrails/venv/bin/pip install --upgrade pip && \
    ./apps/sim/lib/guardrails/venv/bin/pip install -r ./apps/sim/lib/guardrails/requirements.txt && \
    chown -R nextjs:nodejs /app/apps/sim/lib/guardrails

# Create .next/cache directory with correct ownership
RUN mkdir -p apps/sim/.next/cache && \
    chown -R nextjs:nodejs apps/sim/.next/cache

# Switch to non-root user
USER nextjs

EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME="0.0.0.0"

CMD ["bun", "apps/sim/server.js"]
