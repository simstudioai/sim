# Sim Cloud Agent Guide

## Project Overview

Sim is an AI agent workflow builder. Turborepo monorepo with Bun workspaces.

### Services

| Service | Port | Command |
|---------|------|---------|
| Next.js App | 3000 | `bun run dev` (from root) |
| Realtime Socket Server | 3002 | `cd apps/sim && bun run dev:sockets` |
| Both together | 3000+3002 | `bun run dev:full` (from root) |
| Docs site | 3001 | `cd apps/docs && bun run dev` |
| PostgreSQL (pgvector) | 5432 | Docker container `simstudio-db` |

## Common Commands

- **Lint**: `bun run lint:check` (read-only) or `bun run lint` (auto-fix)
- **Format**: `bun run format:check` (read-only) or `bun run format` (auto-fix)
- **Test**: `bun run test` (all packages via turborepo)
- **Test single app**: `cd apps/sim && bunx vitest run`
- **Type check**: `bun run type-check`
- **Dev**: `bun run dev:full` (Next.js app + realtime socket server)
- **DB migrations**: `cd packages/db && bunx drizzle-kit migrate --config=./drizzle.config.ts`

## Architecture Notes

- Package manager is **bun** (not npm/npx). Use `bun` and `bunx`.
- Linter/formatter is **Biome** (not ESLint/Prettier).
- Testing framework is **Vitest** with `@sim/testing` for shared mocks/factories.
- Database uses **Drizzle ORM** with PostgreSQL + pgvector.
- Auth is **Better Auth** (session cookies).
- Pre-commit hook runs `bunx lint-staged` which applies `biome check --write`.
- `.npmrc` has `ignore-scripts=true`.
- Docs app requires `fumadocs-mdx` generation before type-check (`bunx fumadocs-mdx` in `apps/docs/`).
- Coding guidelines are in `CLAUDE.md` (root) and `.cursor/rules/*.mdc`.
- See `.github/CONTRIBUTING.md` for contribution workflow details.
