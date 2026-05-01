# Sim App Scope

These rules apply to files under `apps/sim/` in addition to the repository root [AGENTS.md](/AGENTS.md).

## Architecture

### Core Principles

1. **Single Responsibility**: Each component, hook, store has one clear purpose
2. **Composition Over Complexity**: Break down complex logic into smaller pieces
3. **Type Safety First**: TypeScript interfaces for all props, state, return types
4. **Predictable State**: Zustand for global state, useState for UI-only concerns

### Root-Level Structure

```
apps/sim/
├── app/                 # Next.js app router (pages, API routes)
├── blocks/              # Block definitions and registry
├── components/          # Shared UI (emcn/, ui/)
├── executor/            # Workflow execution engine
├── hooks/               # Shared hooks (queries/, selectors/)
├── lib/                 # App-wide utilities
├── providers/           # LLM provider integrations
├── stores/              # Zustand stores
├── tools/               # Tool definitions
└── triggers/            # Trigger definitions
```

The Socket.IO collaborative-canvas server lives in a separate workspace at
`apps/realtime/`. It shares DB + auth with `apps/sim` via the `@sim/*`
packages. Do not add imports from `@/lib/webhooks/providers/*`, `@/executor/*`,
`@/blocks/*`, or `@/tools/*` to any package consumed by `apps/realtime` —
those heavyweight registries stay in this app. `apps/realtime` calls back
into this app only over internal HTTP with `INTERNAL_API_SECRET`.

### Feature Organization

Features live under `app/workspace/[workspaceId]/`:

```
feature/
├── components/          # Feature components
├── hooks/               # Feature-scoped hooks
├── utils/               # Feature-scoped utilities (2+ consumers)
├── feature.tsx          # Main component
└── page.tsx             # Next.js page entry
```

### Naming Conventions

- **Components**: PascalCase (`WorkflowList`)
- **Hooks**: `use` prefix (`useWorkflowOperations`)
- **Files**: kebab-case (`workflow-list.tsx`)
- **Stores**: `stores/feature/store.ts`
- **Constants**: SCREAMING_SNAKE_CASE
- **Interfaces**: PascalCase with suffix (`WorkflowListProps`)

## Imports And Types

- Always use absolute imports from `@/...`; do not add relative imports.
- Use barrel exports only when a folder has 3+ exports; do not re-export through non-barrel files.
- Use `import type` for type-only imports.
- Do not use `any`; prefer precise types or `unknown` with guards.

## Components And Styling

- Use `'use client'` only when hooks or browser-only APIs are required.
- Define a props interface for every component.
- Extract constants with `as const` where appropriate.
- Use Tailwind classes and `cn()` for conditional classes; avoid inline styles unless CSS variables are the intended mechanism.
- Keep styling local to the component; do not modify global styles for feature work.

## API Contracts

Boundary HTTP request and response shapes for all routes under `apps/sim/app/api/`** live in `apps/sim/lib/api/contracts/**` (one file per resource family). Routes never define route-local boundary Zod schemas, and clients never define ad-hoc wire types — both sides consume the same contract.

- Each contract is built with `defineRouteContract({ method, path, params?, query?, body?, headers?, response: { mode: 'json', schema } })` from `@/lib/api/contracts`.
- Contracts export named schemas AND named TypeScript type aliases (e.g., `export type CreateFolderBody = z.input<typeof createFolderBodySchema>`). Clients import the named aliases — never `z.input<...>` / `z.output<...>` in hooks.
- Shared identifier schemas live in `apps/sim/lib/api/contracts/primitives.ts` (e.g., `workspaceIdSchema`, `workflowIdSchema`).
- Audit script: `bun run check:api-validation` enforces boundary policy and prints ratchet metrics for route Zod imports, route-local schema constructors, route `ZodError` references, client hook Zod imports, and related counters. It must pass on PRs. `bun run check:api-validation:strict` is the strict CI gate and additionally fails on annotations with empty reasons.
- Domain validators that are not HTTP boundaries — tools, blocks, triggers, connectors, realtime handlers, and internal helpers — may still use Zod directly. The contract rule is boundary-only.

### Boundary annotations

A small number of legitimate exceptions to the boundary rules are tolerated when annotated. The audit script recognizes four annotation forms:

- `// boundary-raw-fetch: <reason>` — placed on the line directly above a raw `fetch(` call inside `apps/sim/hooks/queries/**`, `apps/sim/hooks/selectors/**`, or any other client/UI source under `apps/sim/**` that targets a same-origin `/api/...` URL. Use only for documented exceptions: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests.
- `// double-cast-allowed: <reason>` — placed on the line directly above an `as unknown as X` cast outside test files.
- `// boundary-raw-json: <reason>` — placed on the line directly above a raw `await request.json()` / `await req.json()` read (or the multi-line `await request.clone().json()` shim variant) in a route handler. Use only when the body is a JSON-RPC envelope, a tolerant `.catch(() => ({}))` parse, or otherwise cannot go through `parseRequest`.
- `// untyped-response: <reason>` — placed on the line directly above a `schema: z.unknown()` / `schema: z.object({}).passthrough()` / `schema: z.record(z.string(), z.unknown())` response declaration (or a simple alias to one of those) in a contract file. Use only when the response body is genuinely opaque (user-supplied data, third-party passthrough).

Placement rule: the annotation must immediately precede the call or cast. Up to three non-empty preceding comment lines are tolerated, so additional context comments above the annotation are fine. The reason must be non-empty after trimming — annotations with empty reasons fail strict mode (`annotationsMissingReason`).

Whole-file allowlists for routes (legitimate non-boundary or auth-handled routes that legitimately import Zod for non-boundary reasons) go through `INDIRECT_ZOD_ROUTES` in `scripts/check-api-validation-contracts.ts`, not per-line annotations.

Examples:

```ts
// boundary-raw-fetch: streaming SSE chunks must be processed as they arrive
const response = await fetch(`/api/copilot/chat/stream?chatId=${chatId}`, { signal })
```

```ts
// double-cast-allowed: legacy provider type lacks the discriminator field we need
const provider = config as unknown as LegacyProvider
```

```ts
// boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
const body = await request
  .clone()
  .json()
  .catch(() => undefined)
```

```ts
// untyped-response: forwards firecrawl /v2/parse response unchanged for downstream tool consumers
output: z.unknown(),
```

## API Route Pattern

Routes never `import { z } from 'zod'` and never define route-local boundary schemas. They consume the contract from `@/lib/api/contracts/**` and validate with canonical helpers from `@/lib/api/server`:

- `parseRequest(contract, request, context, options?)` — fully contract-bound routes; parses params, query, body, and headers in one call. Pass `{}` for `context` on routes without route params, or the route's `context` argument when route params exist. Returns a discriminated union; check `parsed.success` and return `parsed.response` on failure.
- `validationErrorResponse(error)` and `getValidationErrorMessage(error, fallback)` — produce 400 responses from a `ZodError`.
- `validationErrorResponseFromError(error)` — when handling unknown caught errors that may or may not be a `ZodError`.
- `isZodError(error)` — type guard. Routes never use `instanceof z.ZodError`.

### Fully contract-bound route (`parseRequest`)

```typescript
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createFolderContract } from '@/lib/api/contracts/folders'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('FoldersAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(createFolderContract, request, {})
  if (!parsed.success) return parsed.response
  const { body } = parsed.data
  logger.info('Creating folder', { workspaceId: body.workspaceId })
  return NextResponse.json({ ok: true })
})
```

Routes under `apps/sim/app/api/v1/**` use the shared middleware in `apps/sim/app/api/v1/middleware.ts` for auth, rate-limit, and workspace access. Compose contract validation inside that middleware — never reimplement auth/rate-limit per-route.

### Adding a new boundary feature end-to-end

When adding a new route + client surface, follow this order. Each step has one place it lives.

1. **Author the contract first** in `apps/sim/lib/api/contracts/<domain>.ts` (or a subdirectory for large domains: `knowledge/`, `selectors/`, `tools/`). Define one schema per request slice (`params`, `query`, `body`, `headers`) and one for the response, then wrap with `defineRouteContract`. Export named type aliases (`z.input` for inputs, `z.output` for outputs).
2. **Implement the route** in `apps/sim/app/api/<path>/route.ts`. Auth always runs **before** `parseRequest` — never validate untrusted input before authenticating the caller. The route returns exactly the shape declared in `contract.response.schema`.
3. **Add the React Query hook** in `apps/sim/hooks/queries/<domain>.ts`. Use `requestJson(contract, input)` for the call. Build a hierarchical query-key factory (`all` → `lists()` → `list(workspaceId)` → `details()` → `detail(id)`) so invalidations can target prefixes.
4. **Use the hook in the component**. The mutation's `data` and `error` are fully typed from the contract; surface `error.message` (already extracted from the response body's `error` or `message` field by `requestJson`).

### Schema review checklist (read the contract diff like a DB migration)

LLMs will write contracts that compile but are sloppy. The human reviewer should optimize attention on:

- `**required` vs `optional` vs `nullable` is correct**. `optional()` allows omission; `nullable()` allows `null`; chaining both creates a tri-state that's almost never what you want.
- **Response schema matches the route's actual JSON output**. The most common drift bug — route emits a field the schema doesn't declare, or omits a required field. Walk every `NextResponse.json(...)` callsite against the schema.
- **Error messages are descriptive**. `'fileName cannot be empty'` beats `'Required'`. Use the second arg of `min(1, '...')`, `nonempty('...')`, etc. For cross-field refines, use `superRefine` with a `path` and a message that names the failing field.
- **Bounds are set** on arrays (`.min(1)`, `.max(N)`), strings (`.min(1).max(N)` for IDs/names), and numbers (`.min().max()` for limits/sizes).
- `**z.unknown()` is a smell** unless the data is genuinely arbitrary (provider passthrough, user-defined tool result, JSON-RPC envelope). When kept, must be annotated `// untyped-response: <specific reason>` in a `schema:` slot.
- **Discriminated unions over plain unions** when the wire has a discriminant field — gives clients exhaustive narrowing.

CI (`bun run check:api-validation:strict`) catches structural violations (Zod imports in routes, raw `request.json()`, double casts, missing annotations). It does **not** catch these schema-quality judgments — that's the human's job in PR review.

## React Query Client Boundary

Hooks in `apps/sim/hooks/queries/`** consume contracts the same way routes do. Every same-origin JSON call must go through `requestJson(contract, ...)` from `@/lib/api/client/request` instead of raw `fetch`:

- Hooks import named type aliases from `@/lib/api/contracts/**`. Never write `z.input<...>` / `z.output<...>` in hooks, and never `import { z } from 'zod'` in client code.
- `requestJson` parses params, query, body, and headers against the contract on the way out and validates the JSON response on the way back. Hooks always forward `signal` for cancellation.
- Documented exceptions for raw `fetch`: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests. Mark each raw `fetch` with a TSDoc comment explaining which exception applies.

```typescript
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { listEntitiesContract, type EntityList } from '@/lib/api/contracts/entities'

async function fetchEntities(workspaceId: string, signal?: AbortSignal): Promise<EntityList> {
  const data = await requestJson(listEntitiesContract, {
    query: { workspaceId },
    signal,
  })
  return data.entities
}

export function useEntityList(workspaceId?: string) {
  return useQuery({
    queryKey: entityKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchEntities(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
```

## Testing

- Use Vitest.
- Prefer `@vitest-environment node` unless DOM APIs are required.
- Use `vi.hoisted()` + `vi.mock()` + static imports; do not use `vi.resetModules()` + `vi.doMock()` + dynamic imports except for true module-scope singletons.
- Do not use `vi.importActual()`.
- Prefer mocks and factories from `@sim/testing`.

## Utils Rules

- **Never create `utils.ts` for single consumer** - inline it
- **Create `utils.ts` when** 2+ files need the same helper
- **Check existing sources** before duplicating (`lib/` has many utilities)
- **Location**: `lib/` (app-wide) → `feature/utils/` (feature-scoped) → inline (single-use)

