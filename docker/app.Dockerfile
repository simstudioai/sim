# ========================================
# Base Stage: runtime-only dependencies (inherited by the final image)
# ========================================
FROM oven/bun:1.4.1-slim AS base

# Install Node.js 24 (Active LTS) and the runtime dependencies once in base.
# Node runs only the isolated-vm sandbox worker (the app itself runs under Bun);
# the version is kept in lockstep with the `isolated-vm` pin in
# apps/sim/package.json — Node 24 (ABI 137) requires isolated-vm 6.x.
#
# Only what the running container needs belongs here. ffmpeg backs the media
# subprocess adapter; python3 is the node-gyp interpreter and is kept because
# build-base inherits from this stage. The compiler toolchain lives in build-base
# so the runner does not ship it.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3 curl ca-certificates bash ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs

# ========================================
# Build Base: adds the native toolchain the isolated-vm rebuild needs
# ========================================
FROM base AS build-base

# The compiler toolchain, needed only to build isolated-vm against Node. The
# runner copies the finished binary from deps, so shipping these would inflate
# every ECS task pull for nothing: measured 1.21 GB for base against 1.6 GB for
# build-base, so ~390 MB stays out of the final image.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    python3-pip python3-venv make g++

# ========================================
# Pruner Stage: Emit a minimal monorepo subset that sim depends on
# ========================================
FROM build-base AS pruner
WORKDIR /app

COPY . .

# Read the package name from the app manifest. The published CLI also owns the
# `sim` package name, so a hard-coded historical name can silently prune the CLI
# instead of the application after either package is renamed.
RUN APP_PACKAGE_NAME="$(bun -e "console.log(require('./apps/sim/package.json').name)")" && \
    TURBO_VERSION="$(bun -e "console.log(require('./package.json').devDependencies.turbo)")" && \
    bunx --bun "turbo@${TURBO_VERSION}" prune "$APP_PACKAGE_NAME" --docker

# ========================================
# Dependencies Stage: Install Dependencies
# ========================================
FROM build-base AS deps
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
#
# node-gyp comes from the lockfile, not `npx`. It is a devDependency of apps/sim
# purely so `turbo prune` keeps it: the only other copy is transitive through
# `@electron/rebuild`, which belongs to apps/desktop and is pruned away. `npx`
# resolved it from the registry at build time, which pulled a different major
# (13.x vs the pinned 12.4.0) and bypassed the `minimumReleaseAge` supply-chain
# gate in bunfig.toml on every production image build.
#
# This stage contains only the pruned workspace manifests, while the full lockfile
# still describes every workspace. Bun must be allowed to normalize that lockfile
# to the pruned graph; the full-repository CI install owns frozen-lockfile validation.
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    --mount=type=cache,id=npm-cache,target=/root/.npm \
    HUSKY=0 bun install --ignore-scripts --linker=hoisted && \
    cd node_modules/isolated-vm && JOBS=4 /app/node_modules/.bin/node-gyp rebuild --release

# ========================================
# Builder Stage: Build the Application
# ========================================
FROM build-base AS builder
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

# Dummy values so next build can evaluate modules. Override at runtime.
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/dummy"
ENV DATABASE_URL=${DATABASE_URL}

ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

# Per-platform cache id keeps arm64/amd64 SWC artifacts isolated.
RUN --mount=type=cache,id=next-cache-${TARGETPLATFORM},target=/app/apps/sim/.next/cache \
    --mount=type=cache,id=turbo-cache-${TARGETPLATFORM},target=/app/.turbo \
    bun run build

# Bundle the secrets-loading bootstrap into a self-contained entrypoint. It runs
# before (and outside) the Next standalone server, so its dependencies
# (@sim/runtime-secrets, AWS SDK) are inlined here rather than resolved from the
# pruned standalone node_modules. The dynamic import of ./server.js stays a
# runtime import.
RUN bun build apps/sim/bootstrap.ts --target=bun --outfile=apps/sim/bootstrap.js

# ========================================
# Runner Stage: Run the actual app
# ========================================

FROM base AS runner
WORKDIR /app

# Node.js 24, Python, ffmpeg, etc. are already installed in base stage
ENV NODE_ENV=production

# Create non-root user and group
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nextjs

# Copy application artifacts from builder
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/public ./apps/sim/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/.next/static ./apps/sim/.next/static

# Self-contained secrets-loading bootstrap (bundled in the builder stage). Runs
# before the standalone server.js to hydrate process.env from the runtime secret.
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/bootstrap.js ./apps/sim/bootstrap.js

# Copy blog/author content for runtime filesystem reads (not part of the JS bundle)
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/content ./apps/sim/content

# Copy isolated-vm native module (compiled for Node.js in deps stage)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/isolated-vm ./node_modules/isolated-vm

# The collab-doc seed/merge/persist routes run the converter (markdown <-> Yjs) server-side. `yjs` is a
# serverExternalPackage, and the Next standalone tracer copies it only partially — it misses ESM subpath
# files that `yjs/dist/yjs.mjs` imports through `lib0`'s exports map (e.g. `lib0/logging`), so the seed
# 500s ("Cannot find module 'lib0/logging'") and every collaborative doc is stuck read-only. Overwrite
# the partial trace with the complete packages from the full install (outputFileTracingIncludes can't:
# its globs resolve against apps/sim, but these deps hoist to the monorepo-root node_modules).
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/lib0 ./node_modules/lib0
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/yjs ./node_modules/yjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/y-protocols ./node_modules/y-protocols

# `@img/sharp-<platform>` loads libvips from `@img/sharp-libvips-<platform>` through the dynamic
# linker, not a JS require, so the tracer copies the binding but not the library and sharp dies with
# "ERR_DLOPEN_FAILED: libvips-cpp.so: cannot open shared object file". Same hoisting reason as the Yjs
# stack above. Copying whole directories keeps these arch-agnostic (each build's deps stage holds only
# its own platform's packages) and keeps sharp and its binding on the same install. Must stay below
# the standalone COPY, which ships its own partial node_modules that would otherwise win.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

# PDF.js requires native canvas primitives even for text extraction. Standalone
# tracing can miss the platform binding behind canvas's dynamic require. Copy
# the complete matching install after the partial standalone node_modules.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@napi-rs ./node_modules/@napi-rs

# Copy the isolated-vm worker script
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/execution/isolated-vm-worker.cjs ./apps/sim/lib/execution/isolated-vm-worker.cjs

# Copy the pre-built sandbox library bundles (pptxgenjs, docx, pdf-lib) that
# run inside the V8 isolate. Committed into the repo; see
# apps/sim/lib/execution/sandbox/bundles/build.ts to regenerate.
COPY --from=builder --chown=nextjs:nodejs /app/apps/sim/lib/execution/sandbox/bundles ./apps/sim/lib/execution/sandbox/bundles

# Guardrails PII runs in a standalone Presidio service (combined analyzer +
# anonymizer, docker/pii.Dockerfile), reached over the network via PII_URL —
# no Python/Presidio in this image.

# Create .next/cache directory with correct ownership
RUN mkdir -p apps/sim/.next/cache && \
    chown -R nextjs:nodejs apps/sim/.next/cache

# Switch to non-root user
USER nextjs

EXPOSE 3000
ENV PORT=3000 \
    HOSTNAME="0.0.0.0"

CMD ["bun", "apps/sim/bootstrap.js"]
