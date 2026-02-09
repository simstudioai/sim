# Sim Studio - Cloud Agent Development Guide

## Overview

Sim Studio is a monorepo for building and deploying AI agent workflows. See `CLAUDE.md` and `README.md` for architecture, coding standards, and integration guidelines.

## Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js app | `bun run dev` (from root) | 3000 | Main application |
| Socket.IO realtime | `bun run dev:sockets` (from `apps/sim`) | 3002 | Collaborative editing |
| Both together | `bun run dev:full` (from `apps/sim` or root) | 3000, 3002 | Recommended for development |
| Docs | `bun run dev` (from `apps/docs`) | 3001 | Optional documentation site |
| PostgreSQL + pgvector | Docker container | 5432 | Required database |

## Key Commands

- **Lint**: `bun run lint:check` (biome check, no auto-fix) or `bun run lint` (with auto-fix)
- **Format**: `bun run format:check` or `bun run format` (with auto-fix)
- **Test**: `bun run test` (runs vitest via turbo across packages)
- **Type-check**: `bun run type-check` (runs tsc --noEmit via turbo)
- **Dev**: `bun run dev:full` from root or `apps/sim` (starts Next.js + Socket.IO)

## Database

- PostgreSQL with pgvector extension, connection via `DATABASE_URL` in `.env` files
- Migrations: `cd packages/db && bunx drizzle-kit migrate --config=./drizzle.config.ts`
- Schema push (no migration files): `cd packages/db && bunx drizzle-kit push --config=./drizzle.config.ts`
- Two `.env` files are needed: `apps/sim/.env` and `packages/db/.env` (both need `DATABASE_URL`)

## Testing

- Framework: Vitest (config at `apps/sim/vitest.config.ts`)
- Use `@sim/testing` mocks/factories (see `.cursor/rules/sim-testing.mdc`)
- Tests run in parallel with thread pool
- Run specific test: `cd apps/sim && bunx vitest run path/to/test.test.ts`

## Important Notes

- Package manager is **bun** (not npm/pnpm). Use `bun` and `bunx` commands.
- The docs app requires `fumadocs-mdx` generation before type-check: `cd apps/docs && bunx fumadocs-mdx`
- Pre-commit hook runs `bunx lint-staged` which applies biome check with auto-fix
- Social provider warnings (GitHub/Google missing clientId) during startup are expected in local dev
- Redis warnings ("REDIS_URL not configured") are expected - app runs in single-pod mode locally
