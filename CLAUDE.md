# Sim Development Guidelines

This file (also `AGENTS.md`) holds the repo-wide rules: Global Standards, Architecture (incl. the Application Operation Boundary), Code Conventions, API Contracts and Routes, Testing, Integrations, and How your work is checked (the local gate to run before calling a change done). Area detail lives in `.claude/rules/*.md`, indexed in `apps/sim/AGENTS.md`: Claude loads each one by path, and any other agent reads the file a section points to before editing in that area. Skills live in `.agents/skills/`.

Most rules here are enforced by a `check:*` audit or biome. When one fails, its message and its script's header say what the rule protects and how to fix it: fix the code, never the check, and never add an annotation (`// boundary-raw-fetch:`, `// double-cast-allowed:`, …) to silence a fixable finding.

## Global Standards

- **Package manager**: `bun` and `bunx`, never `npm` and `npx`.
- **Logging**: `createLogger` from `@sim/logger`, never `console.log`. Messages are static text and ids go in metadata (`logger.info('Sync started', { documentId })`); inside `withRouteHandler` every line already carries the request ID.
- **Comments**: name things so the code explains itself. TSDoc on exported APIs and non-obvious modules; an inline `//` only for a terse, non-obvious *why* or a script-enforced `// <tag>: <reason>` annotation. History goes in the commit message. No `====` separators, commented-out code, or ESLint directives (`check:comment-hygiene`).
- **Common utilities**: use the `@sim/utils/<module>` helpers (`id`, `random`, `errors`, `object`, `coerce`, `string`, `helpers`, `retry`) over inline versions. IDs are `generateId()` (default) or `generateShortId()` from `@sim/utils/id`, never `randomUUID`, `nanoid`, or `uuid`: the helpers also work in non-secure (HTTP) browsers. `check:utils` bans the inline forms and names the replacement. It cannot catch these, so reach for them yourself: `toArray` and `toStringOrNull`/`toNumberOrNull`/`toBooleanOrNull` for untyped payloads, `compareStrings` (never `localeCompare`) for hashes and cross-process ordering, and `backoffWithJitter`/`parseRetryAfter` for retries. Where the source is already typed, keep an inline `Array.isArray` check (it narrows; `toArray` asserts), and keep a local helper that deliberately differs (returns `undefined` instead of `null`, or a stricter `Number.isFinite` check).
- **Deployment flags in the browser**: client code reads `hosted`, `billingEnabled`, `chatEnabled`, and enterprise flags through `useDeploymentShape()` / `getDeploymentShape()` from `@/lib/core/config/deployment-shape`, never `env-flags` (its values freeze wrong on 404 and error shells). Server code keeps `env-flags` (`check:client-boundary`).
- **Type-checking**: `bun run type-check` at the root checks every workspace (inside a workspace it checks just that one). `apps/sim` excludes `*.test.ts(x)` from it; CI's `check:test-types` ratchets their errors per file instead. Keep the unused `@typescript/native` root devDependency (`check:native-typecheck`).

## Architecture

- **Layout**: `apps/sim` is the Next.js app (UI, API routes, executor; use cases live in `lib/<domain>/application`), `apps/realtime` the collaborative Socket.IO server, `apps/desktop` an Electron shell around the hosted web app, `apps/docs` the docs site, and `apps/pii` a Python service outside the JS/turbo build. Shared code is in `packages/*` (`@sim/*`).
- **Package boundaries**: `apps/* → packages/*` only; packages never import from `apps/*`. `apps/realtime` (a Bun Socket.IO server) avoids Next.js, React, the block/tool registry, provider SDKs, and the executor, and calls `apps/sim` only over internal HTTP with `INTERNAL_API_SECRET` (`check:boundaries`, `check:realtime-prune`). Both apps share Better Auth sessions through `@sim/db` and the same `BETTER_AUTH_SECRET`.
- `'use client'` boundary, app/worker env split, and feature folder layout: `.claude/rules/sim-architecture.md`.

### Application Operation Boundary

- Every protected read, write, canonical resource lookup, or authorization-sensitive reference resolution enters through one authorized application use case with its minimum role, workspace-key policy, and allowed principal kinds. Internal APIs, v2 APIs, Copilot (via `createCopilotApplicationAdapter`), and trusted tools call the same use case for the same domain behavior.
- Surface adapters authenticate, build a `Principal`, apply rate policy, parse contracts, and present results. They never query protected data, decide authorization, run business transactions, or record semantic audit (`check:source-conventions` ratchets value imports of `@sim/db` under `app/api/`). Managers accept canonical IDs and scope, never credentials or principals. Application code stays surface-neutral (`check:boundaries`): no `next/server`, `app/api/**`, or runtime import of a route contract object, presenter, or Copilot handler (contract types, schemas, and constants are fine).
- A protected compound mutation is one top-level operation, never a sequence of independently committing mutations in an adapter.
- Never substitute a billing owner, uploader, creator, or API-key owner for the acting principal; fail fast when the identity model cannot express the caller.
- Use the `migrate-application-operation` skill for any new or migrated protected endpoint, tool command, or resource method.

## Code Conventions

- **Naming**: components PascalCase, hooks `use*`, files kebab-case, constants SCREAMING_SNAKE_CASE, interfaces with a suffix (`WorkflowListProps`), stores at `stores/<feature>/store.ts`. Inside `lib/`, `executor/`, `providers/`, `stores/`, `hooks/`, `serializer/`, and a package's `src/`, a file never starts with its folder's name (`logs/views.ts`, not `logs/log-views.ts`; `feature/feature.tsx` stays the component convention), and a file in `utils/` or `helpers/` never repeats that role (`date.ts`, not `date-utils.ts`) (`check:file-names`).
- **Imports**: absolute (`@/...`) only; a folder with 3+ exports gets an `index.ts` barrel, and nothing re-exports from a non-barrel file; `import type` for type-only imports (`.claude/rules/sim-imports.md`).
- **TypeScript**: no `any` (use precise types or `unknown` with guards), no non-null `!`, no export nothing imports (`check:explicit-any`, `check:unused-exports`). Unused bindings fail biome with no autofix: delete them and update callers, and write `catch {}` when the error is unused. `_` only for a parameter that must hold its position or a type parameter kept for API shape; `const { a, ...rest } = obj` is fine.
- **Utils**: check `lib/` and the `@sim/utils/<module>` helpers before writing a helper. Inline a helper with one consumer; create `utils.ts` (in `lib/` or `feature/utils/`) only when 2+ files share it.
- **Caching**: `lru-cache` with a `max` ceiling, never a hand-rolled TTL `Map`; cache the gate, never the credential (`.claude/rules/sim-caching.md`).
- **State ownership**: React Query owns server data (never `useState` + `fetch`); shareable view-state (tabs, filters, search, pagination, selected id) lives in the URL via `nuqs`; Zustand owns global client state; `useState` owns UI-only state. Hooks, queries, stores, URL state, components, lists and menus, and render performance each have a rule file in `.claude/rules/`.
- **UI**: Tailwind and the `@sim/emcn` chip family (`.claude/rules/sim-styling.md`); product copy `.claude/rules/sim-ui-copy.md`; marketing copy `.claude/rules/constitution.md`.

## API Contracts and Routes

- Request/response shapes for every route under `apps/sim/app/api/**` live in `apps/sim/lib/api/contracts/**` via `defineRouteContract`. Routes never import `zod`; clients never hand-write wire types.
- Handlers use the shared builders (`defineInternalJsonRoute`, `defineV2JsonRoute`, binary/stream variants), which already apply `withRouteHandler`; never double-wrap or export a bare handler.
- Same-origin JSON calls use `requestJson(contract, ...)` from `@/lib/api/client/request`. A raw `fetch` is only for streaming, binary, multipart, signed URLs, OAuth redirects, or external origins, and carries `// boundary-raw-fetch: <reason>`.
- `bun run check:api-validation:strict` must pass. Full rules: `.claude/rules/sim-api-contracts.md`.

## Testing

Most unit tests restate the code they test: they pass first time, break on every refactor, and catch nothing type-check, the build, the audits, or a real run would miss. Test for confidence, not coverage.

- Never write unit tests after the code: a test written to describe existing code restates it and proves nothing. When a change needs proof, prove it end to end against the real boundary (real Postgres/Redis `*.integration.ts`, the running app over HTTP (`apps/sim/scripts/test-*-e2e.ts`), or the packaged desktop app), ending in a report artifact written to a caller-supplied `<SUITE>_REPORT_PATH` (`apps/sim/scripts/test-scim-e2e.ts` is the reference).
- Testing in isolation: first list the failure modes (bad input, boundary, concurrency, partial failure, permission denial, resource cap), then write one test per mode that fails before the code exists. A regression test must fail on the pre-fix code: revert each guard of the fix and watch its test go red.
- Never test declarations, mock every collaborator and assert on the mocks, check rendered text or class names, or hand-roll a mock that `apps/sim/vitest.setup.ts` or `@sim/testing` provides (`check:test-patterns`).

Use the `test-audit` skill whenever you write, change, or review tests; mechanics are in `.claude/rules/sim-testing.md`.

## Integrations

Build order **Tools** → **Block** → **Icon** → optional **Trigger**, from the service's API docs, using `/add-integration` (or `/add-tools`, `/add-block`, `/add-trigger`).

- **Tool IDs are `snake_case`** (`service_action`), registered in `tools/registry.ts`; blocks register alphabetically in `blocks/registry-maps.ts`.
- **Type coercions go in `tools.config.params`** (runs at execution), never `tools.config.tool` (runs at serialization, where `Number()` destroys `<Block.output>` references).
- A surface listing integrations to a viewer reads `useIntegrationAccess`, never a raw catalog (`check:integration-access`).
- Table column types are registry entries in `apps/sim/lib/table/column-types/`; never add a per-type `case` elsewhere except the one documented import-path switch (`coerceValue` in `lib/table/import.ts`), which every new type extends: a missed arm fails silently. Use `/add-column-type`.

## How your work is checked

Before declaring a change done, run the local gate from the repo root; CI fails on any of them:

```bash
bun run lint            # biome format + lint, autofixes (CI runs lint:check)
bun run type-check      # every workspace
bun run check:audits    # every check:* audit, generated-artifact checks included
bun run test            # script tests, then every workspace's Vitest suite
git fetch origin staging  # the block-registry check diffs against it
bun run apps/sim/scripts/check-block-registry.ts origin/staging
```

Author a `packages/db` schema change or migration with the `db-migrate` skill and run `bun run check:migrations` (not in `check:audits`). Ratchet baselines (`scripts/*baseline.json`) only shrink: regenerate one with `--update` after removing violations. The one exception is `check:tool-registry-boundary`, whose module-count baseline is re-recorded with `--update-baseline` when growth is deliberate (see the `tool-registry-boundary` skill).
