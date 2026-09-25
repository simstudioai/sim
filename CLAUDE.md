# Sim Development Guidelines

You are a professional software engineer. All code must follow best practices: accurate, readable, clean, and efficient.

This file (also `AGENTS.md`) holds the repo-wide rules. Area detail lives in `.claude/rules/*.md`: Claude loads each one by path, and any other agent reads the file a section points to before editing in that area. Skills live in `.agents/skills/`.

## Global Standards

- **Package manager**: `bun` and `bunx`, never `npm` and `npx`.
- **Logging**: `createLogger` from `@sim/logger`; `logger.info` / `logger.warn` / `logger.error`, never `console.log`. Inside `withRouteHandler` the logger already carries the request ID — no manual `withMetadata({ requestId })`.
- **Comments**: TSDoc for documentation. An inline `//` only for a terse, non-obvious why, or for a script-enforced `// <tag>: <reason>` annotation (`boundary-raw-fetch`, `double-cast-allowed`, `boundary-raw-json`, `untyped-response`, `rq-lint-allow`, `client-boundary-allow`, …). No `====` separators.
- **ID generation**: `generateId()` (UUID v4, the default) or `generateShortId(size?)` (URL-safe, 21 chars by default) from `@sim/utils/id` — never `crypto.randomUUID()`, `nanoid`, or `uuid`. Both use `crypto.getRandomValues()`, so they also work in non-secure (HTTP) browsers.
- **Common utilities**: use the shared helpers from `@sim/utils` instead of inline implementations:
  - `sleep(ms)` from `@sim/utils/helpers` — never `new Promise(resolve => setTimeout(resolve, ms))`
  - `toError(e)` from `@sim/utils/errors` — normalize caught values to `Error`; never `e instanceof Error ? e : new Error(String(e))`
  - `getErrorMessage(e, fallback?)` from `@sim/utils/errors` — never `e instanceof Error ? e.message : 'fallback'`
  - `structuredClone(value)` — built-in deep clone; never `JSON.parse(JSON.stringify(...))`
  - `omit(obj, keys)` / `filterUndefined(obj)` from `@sim/utils/object` — never `Object.fromEntries(Object.entries(...).filter(...))`
  - `isRecordLike(value)` from `@sim/utils/object` — never redeclare `typeof value === 'object' && value !== null && !Array.isArray(value)`
  - `toRecord(value)` / `toRecordOrNull(value)` / `toArray(value)` from `@sim/utils/object` — coerce an untyped payload value; never inline `isRecordLike(v) ? v : {}` or `Array.isArray(v) ? v : []`. Where the source is already typed, keep the inline `Array.isArray` check: it narrows, while `toArray` asserts
  - `toStringOrNull(value)` / `toNumberOrNull(value)` / `toBooleanOrNull(value)` from `@sim/utils/coerce` — read one scalar out of an untyped payload; never declare a local one-liner byte-identical to one of these. Keep a local helper that differs: `undefined` instead of `null` changes the wire shape, and a `Number.isFinite` or string-parse variant is a stricter check these omit
  - `truncate(str, maxLength, suffix?)` from `@sim/utils/string` — never inline slice + ellipsis
  - `escapeRegExp(value)` from `@sim/utils/string` — never inline `replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
  - `compareStrings(left, right)` from `@sim/utils/string` — code-unit ordering for hashes, fingerprints, and cross-process comparisons; never `localeCompare` there
  - `backoffWithJitter(attempt, retryAfterMs, options?)` / `parseRetryAfter(header)` from `@sim/utils/retry` — never reimplement exponential backoff inline
- **Deployment flags in the browser**: client code inside a workspace, organization, or standalone settings surface reads `hosted`, `billingEnabled`, `chatEnabled`, and the enterprise feature set through `useDeploymentShape()` (components) or `getDeploymentShape()` (block conditions, stores, helpers) from `@/lib/core/config/deployment-shape`, never `isHosted`/`isBillingEnabled`/... from `env-flags`. Those constants freeze at module init from the root layout's `NEXT_PUBLIC_*` transport, which Next's bare 404 shell and `global-error` never emit, so a recovered tab would render Sim Cloud as self-hosted; the reader is seeded from the server-resolved workspace host context, organization layout, or standalone settings layout instead. Server code keeps reading `env-flags`.
- **Type-checking**: `bun run type-check` (per workspace) or `bunx turbo run type-check` (all). Never remove the `@typescript/native` alias from the root `devDependencies`. Nothing imports it; it exists so a bare `tsc` resolves to the native TypeScript 7 compiler. `apps/sim` needs `@typescript/typescript6`, whose `@typescript/old` dependency (an alias of `typescript@6`) ships its own `tsc` bin, and bin winners are picked by lexical sort, so without the alias `tsc` silently becomes the ~10x slower JavaScript compiler. `bun run check:native-typecheck` enforces this ([microsoft/typescript-go#4567](https://github.com/microsoft/typescript-go/issues/4567)).
- **Checks**: `bun run lint` autofixes formatting; `bun run check:audits` runs every `check:*` audit CI enforces.

## Architecture

### Repository layout

```
apps/
├── sim/                    # Next.js app: UI, API routes, workflow builder, executor
│   ├── app/                # App router — pages and API routes (app/api/**)
│   ├── blocks/             # Block definitions and registry
│   ├── tools/              # Tool definitions and registry
│   ├── triggers/           # Trigger definitions and registry
│   ├── connectors/         # Knowledge base connectors
│   ├── executor/           # Workflow execution engine
│   ├── providers/          # LLM provider integrations
│   ├── components/         # Shared app UI (ui/, icons, …)
│   ├── hooks/              # Shared hooks (queries/, selectors/)
│   ├── stores/             # Zustand stores
│   ├── lib/                # App-wide modules, incl. lib/api/contracts and lib/<domain>/application
│   └── ee/                 # Enterprise features
├── realtime/               # Bun Socket.IO server (collaborative workflow builder)
├── desktop/                # Electron shell around the hosted web app
├── docs/                   # Documentation site
└── pii/                    # Python PII detection service (not in the JS/turbo build)

packages/
├── emcn/                   # @sim/emcn — design system (chip family, tokens, icons)
├── db/                     # @sim/db — Drizzle schema, migrations, client
├── auth/                   # @sim/auth — shared Better Auth verifier
├── platform-authz/         # @sim/platform-authz — workspace + workflow authz (subpath exports)
├── audit/ logger/ security/ utils/ runtime-secrets/ deployment-config/
├── realtime-protocol/ browser-protocol/ terminal-protocol/ desktop-bridge/
├── workflow-types/ workflow-persistence/ workflow-renderer/
├── testing/                # @sim/testing — test factories and mocks
├── tsconfig/               # shared tsconfig presets
└── cli/ sim-cli/ sim-setup/ ts-sdk/ python-sdk/   # published CLIs and SDKs
```

### Package boundaries

- `apps/* → packages/*` only. Packages never import from `apps/*`.
- `apps/realtime` avoids Next.js, React, the block/tool registry, provider SDKs, and the executor. Never add imports from `@/lib/webhooks/providers/*`, `@/executor/*`, `@/blocks/*`, or `@/tools/*` to any package it consumes; it calls back into `apps/sim` only over internal HTTP with `INTERNAL_API_SECRET`. CI enforces this via `scripts/check-monorepo-boundaries.ts` and `scripts/check-realtime-prune-graph.ts`.
- Auth is shared across both apps via the Better Auth "Shared Database Session" pattern (same `BETTER_AUTH_SECRET`, same DB via `@sim/db`).

### Application Operation Boundary

- Every protected read, write, canonical resource lookup, or authorization-sensitive reference resolution enters through an authorized application use case.
- Define one stable semantic operation with its minimum role, workspace-key policy, allowed principal kinds, and delegated services. Internal APIs, v2 APIs, Copilot, and trusted tools call the same use case when the domain behavior is the same.
- Surface adapters authenticate and construct a `Principal`, apply request-rate policy, parse contracts, map input, and present their own result. They never query protected data, decide resource authorization, implement business transactions, or record semantic audit.
- Application use cases load canonical context, compare asserted scope, authorize current access, execute managers/repositories, project semantic audit, and trigger shared domain effects. Managers accept canonical IDs and scope, never credentials or principals. Application code stays surface-neutral: it never imports `app/api/**`, `next/server`, route contracts/presenters, or Copilot handlers.
- Copilot is a surface adapter. Use `createCopilotApplicationAdapter` and the domain's registered operation object; never a Copilot-only authorization or business implementation.
- Protected compound mutations belong in one top-level semantic application operation, never a sequence of independently committing mutations in a route or tool adapter.
- Never substitute a billing owner, uploader, creator, or API-key owner for the acting principal. Fail fast when the identity model or operation policy cannot express the caller.
- Use the `migrate-application-operation` skill whenever creating or migrating a protected endpoint, tool command, or resource method.

The `'use client'` server boundary, the app/worker runtime env split, and feature folder layout are in `.claude/rules/sim-architecture.md`.

## Code Conventions

- **Naming**: components PascalCase (`WorkflowList`); hooks `use*`; files kebab-case (`workflow-list.tsx`); constants SCREAMING_SNAKE_CASE; interfaces PascalCase with a suffix (`WorkflowListProps`); stores `stores/<feature>/store.ts`.
- **Imports**: absolute (`@/...`) only, never relative. A folder with 3+ exports gets an `index.ts` barrel; never re-export from a non-barrel file. `import type` for type-only imports. Order and lazy-loading through barrels: `.claude/rules/sim-imports.md`.
- **TypeScript**: no `any` (use precise types or `unknown` with guards); a props interface for every component; `as const` for constant objects/arrays; explicit ref types (`useRef<HTMLDivElement>(null)`).
- **Components**: `'use client'` only for hooks or browser APIs. Structure order, extraction thresholds, and list-render rules: `.claude/rules/sim-components.md`. Render-performance idioms (lazy-init refs, hoisting, `Map` pre-indexing, `[...arr].sort()` never `toSorted()` on client paths): `.claude/rules/sim-react-performance.md`. For effect/state/memo/callback anti-patterns use the `/you-might-not-need-*` skills and verify against the running UI.
- **State ownership**: React Query owns server data — never `useState` + `fetch`; shareable client view-state (tabs, filters, search, pagination, selected id) lives in the URL via `nuqs`; Zustand owns global client state; `useState` owns UI-only state. Hooks: `.claude/rules/sim-hooks.md`. Stores (`devtools`, `persist` only with an explicit `partialize` whitelist, workflow value invariants): `.claude/rules/sim-stores.md`. URL state: `.claude/rules/sim-url-state.md`.
- **Utils**: inline a helper with one consumer; create `utils.ts` when 2+ files share it — in `lib/` (app-wide) or `feature/utils/` (feature-scoped). Check `lib/` before writing a new one.
- **Lists and menus** mirror the order the user already reads elsewhere (sidebar, toolbar), encoded in one exported order constant; a separator marks only a change in what the action acts on (typically one, before the destructive action): `.claude/rules/sim-list-ordering.md`.
- **Caching**: `lru-cache` with a `max` ceiling, never a hand-rolled TTL `Map`; a lifecycle map is not a cache; cache the gate, never the credential: `.claude/rules/sim-caching.md`.

## API Contracts and Routes

- Request/response shapes for every route under `apps/sim/app/api/**` live in `apps/sim/lib/api/contracts/**`, built with `defineRouteContract` and exporting named schemas plus named type aliases. Routes never import `zod` or define route-local boundary schemas; clients never write ad-hoc wire types or `z.input`/`z.output`.
- Every route handler runs inside `withRouteHandler`. Ordinary internal and v2 routes use the shared builders (`defineInternalJsonRoute`, `defineV2JsonRoute`, binary/stream variants), which already apply it — never double-wrap. Raw `withRouteHandler` is only for documented protocol or lifecycle exceptions. Never export a bare `async function GET/POST/...`.
- Same-origin JSON calls go through `requestJson(contract, ...)` from `@/lib/api/client/request`. A raw `fetch` is only for streaming, binary downloads, multipart uploads, signed URLs, OAuth redirects, or external origins, and carries `// boundary-raw-fetch: <reason>`.
- The other script-enforced exceptions are `// double-cast-allowed:`, `// boundary-raw-json:`, and `// untyped-response:`. Never add one to silence a fixable finding.
- `bun run check:api-validation:strict` must pass. Full contract rules, route pattern, annotation placement, the end-to-end order, and the schema review checklist: `.claude/rules/sim-api-contracts.md`. React Query hooks (key factories, named `staleTime` constants, `signal`, invalidation, server prefetch): `.claude/rules/sim-queries.md`.

## Styling and EMCN

- Tailwind only. Inline `style` only for a genuinely dynamic value or a CSS variable. Never update global styles; keep styling local to the component. `cn()` from `@sim/emcn` for conditional classes. `size-*` for equal height and width (icons default `size-[14px]`), never `h-N w-N`.
- Import components, `cn`, and tokens from the `@sim/emcn` barrel; icons from `@sim/emcn/icons`; CSS modules by file path. Never deep-import other component subpaths.
- The chip family is the canonical chrome: `ChipInput`, `ChipTextarea`, `ChipModal`/`ChipModalField`, `ChipSelect`/`ChipCombobox`/`ChipDropdown`, `ChipSwitch`, `ChipDatePicker`, `Chip`/`ChipLink`, `ChipTag`; `DropdownMenu` for context/action menus. Components own their chrome: consumers pass props (`error`, `icon`, `endAdornment`, `inputClassName`) and `className` carries only layout/sizing. Every labeled field inside a `ChipModalBody` is a `ChipModalField`.
- Consumer rules, tokens, text scale, and modal rhythm: `.claude/rules/sim-styling.md`. Authoring components in `packages/emcn`: `.claude/rules/emcn-components.md`. Product UI copy: `.claude/rules/sim-ui-copy.md`. Marketing copy and positioning: `.claude/rules/constitution.md`.

## Testing

Most unit tests in a codebase like this restate the code they test. They pass on the first run, break on every refactor, and catch nothing that type-check, `next build`, `bun run check:audits`, or a real end-to-end run would miss. Test for confidence, not coverage.

- **Never write unit tests after you write code.** A test written to describe code that already exists restates the implementation and proves nothing. If the change needs proof, prove it end to end.
- **Highly prefer E2E tests.** Use them to verify complex features work, against the real boundary: real Postgres/Redis (`*.integration.ts`), the running app over real HTTP (`apps/sim/scripts/test-*-e2e.ts`), or the packaged desktop app (`apps/desktop/e2e`, Playwright). At the end of an E2E test, produce a verifiable and repeatable artifact — a JSON report of each check with status and duration, an HTTP status log, a trace, or a screenshot — written to a caller-supplied `<SUITE>_REPORT_PATH` and uploaded by CI on failure. `apps/sim/scripts/test-scim-e2e.ts` is the reference.
- **If you must test a system in isolation, first write down all the ways it could fail, then write the code.** Each failure mode (bad input, boundary, concurrency, partial failure, permission denial, resource cap) becomes one test that fails before the code exists.
- A regression test must fail on the pre-fix code. Revert each guard of the fix and watch its test go red before you trust it.
- Never write tests that restate declarations (block/tool/provider config, registries, constants, schemas accepting valid input), assert that mocks were called, check rendered text or class names, or test mocks and factories themselves.
- Never hand-roll a mock or test helper that `apps/sim/vitest.setup.ts` or `@sim/testing` already provides; a module mocked in a third file gets one central mock. `bun run check:test-patterns` enforces this.

Use the `test-audit` skill whenever you write, change, review, or sweep tests — it holds the authoring gate, the junk patterns, and the retention bar. Test layers, file naming, and Vitest mechanics (global mocks, `@sim/testing`, performance rules) are in `.claude/rules/sim-testing.md`.

## Integrations

Build order: **Tools** → **Block** → **Icon** → optional **Trigger**, starting from the service's API docs. Use the skills: `/add-integration` (end-to-end), `/add-tools`, `/add-block`, `/add-trigger`. Two rules the skills assume:

- **Tool IDs are `snake_case`** (`service_action`), registered in `tools/registry.ts`; blocks register in `blocks/registry-maps.ts` (`BLOCK_REGISTRY` + `BLOCK_META_REGISTRY`, alphabetically).
- **Type coercions go in `tools.config.params`** (runs at execution, after variable resolution), never in `tools.config.tool` (runs at serialization, where `Number()` destroys dynamic `<Block.output>` references).

Remaining block/tool/trigger rules: `.claude/rules/sim-integrations.md`. Canvas sentences: `apps/sim/blocks/AGENTS.md`.

## Tables

Table column types are registry entries in `apps/sim/lib/table/column-types/` — one file per type owning its label, icon, storage cast, coercion, validation, conversion compatibility, formatting, and editor. `Record<ColumnType, …>` on `registry.ts` and `registry.server.ts` is a compile-time completeness gate: adding a type to the union errors until both entries exist.

Never add a `case 'sometype':` outside `column-types/` — a missing arm fails silently (a wrong `jsonbCast` breaks every filter on the column). If a consumer needs per-type knowledge, add a registry field. Use `/add-column-type` for the full procedure.
