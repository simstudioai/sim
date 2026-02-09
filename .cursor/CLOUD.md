# Sim Studio - Cloud Agent Guide

## Overview

Sim Studio is a monorepo (Turborepo + Bun workspaces) for building and deploying AI agent workflows. See `CLAUDE.md` for architecture, coding conventions, and integration guides. See `.github/CONTRIBUTING.md` for contributor workflows.

## Services

| Service | Port | Command |
|---------|------|---------|
| Next.js App (sim) | 3000 | `bun run dev` (from root) |
| Realtime Socket Server | 3002 | `bun run dev:sockets` (from root) |
| Both together | 3000 + 3002 | `bun run dev:full` (from root) |
| Docs (Fumadocs) | 3001 | `cd apps/docs && bun run dev` |
| PostgreSQL (pgvector) | 5432 | Docker container `simstudio-db` |

## Key Commands (run from repo root)

| Task | Command |
|------|---------|
| Lint (check only) | `bun run lint:check` |
| Lint (auto-fix) | `bun run lint` |
| Format (check) | `bun run format:check` |
| Format (auto-fix) | `bun run format` |
| Tests | `bun run test` |
| Type check | `bun run type-check` |
| Dev (full) | `bun run dev:full` |
| DB migrations | `cd packages/db && bunx drizzle-kit migrate --config=./drizzle.config.ts` |

## Important Notes

- **Package manager**: Always use `bun` / `bunx`, never `npm` / `npx`.
- **Linter**: Biome (not ESLint). Config at `/workspace/biome.json`.
- **Testing**: Vitest. Test files co-located as `*.test.ts`. Use `@sim/testing` mocks.
- **Pre-commit**: Husky runs `bunx lint-staged` which runs `biome check --write`.
- **Database**: PostgreSQL 17 with pgvector extension. Drizzle ORM for schema/migrations.
- **Env files**: `apps/sim/.env` and `packages/db/.env` must both have `DATABASE_URL`.
- **Docs type-check**: Requires `fumadocs-mdx` to be run first (generates `.source/` directory). This runs as `postinstall` in `apps/docs`.
- **Redis**: Optional. Socket server falls back to in-memory mode without `REDIS_URL`.
- **Auth**: Better Auth. Social providers (GitHub, Google) need `clientId`/`clientSecret` in env. Warnings about missing social provider config are expected in dev.
