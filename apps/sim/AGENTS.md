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

Boundary HTTP request and response shapes for all routes under `apps/sim/app/api/**` live in `apps/sim/lib/api/contracts/**` (one file per resource family). Routes never define route-local boundary Zod schemas, and clients never define ad-hoc wire types — both sides consume the same contract.

- Each contract is built with `defineRouteContract({ method, path, params?, query?, body?, headers?, response: { mode: 'json', schema } })` from `@/lib/api/contracts`.
- Contracts export named schemas AND named TypeScript type aliases (e.g., `export type CreateFolderBody = z.input<typeof createFolderBodySchema>`). Clients import the named aliases — never `z.input<...>` / `z.output<...>` in hooks.
- Shared identifier schemas live in `apps/sim/lib/api/contracts/primitives.ts` (e.g., `workspaceIdSchema`, `workflowIdSchema`).
- Audit script: `bun run check:api-validation` enforces boundary policy and prints ratchet metrics for route Zod imports, route-local schema constructors, route `ZodError` references, client hook Zod imports, and related counters. It must pass on PRs. `bun run check:api-validation:strict` is the strict CI gate and additionally fails on annotations with empty reasons.
- Domain validators that are not HTTP boundaries — tools, blocks, triggers, connectors, realtime handlers, and internal helpers — may still use Zod directly. The contract rule is boundary-only.

### Boundary annotations

A small number of legitimate exceptions to the boundary rules are tolerated when annotated. The audit script recognizes two annotation forms:

- `// boundary-raw-fetch: <reason>` — placed on the line directly above a raw `fetch(` call inside `apps/sim/hooks/queries/**` or `apps/sim/hooks/selectors/**`. Use only for documented exceptions: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests.
- `// double-cast-allowed: <reason>` — placed on the line directly above an `as unknown as X` cast outside test files.

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

## API Route Pattern

Routes never `import { z } from 'zod'` and never define route-local boundary schemas. They consume the contract from `@/lib/api/contracts/**` and validate with canonical helpers from `@/lib/api/server`:

- `parseRequest(contract, request, context)` — fully contract-bound routes; parses params, query, body, and headers in one call.
- `validateSchema(schema, data)` — for ad-hoc validation against a contract schema or primitive.
- `validationErrorResponse(error)` and `getValidationErrorMessage(error, fallback)` — produce 400 responses from a `ZodError`.
- `validationErrorResponseFromError(error)` — when handling unknown caught errors that may or may not be a `ZodError`.
- `isZodError(error)` — type guard. Routes never use `instanceof z.ZodError`.

### Fully contract-bound route (`parseRequest`)

```typescript
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createFolderContract } from '@/lib/api/contracts/folders'
import { parseRequest, validationErrorResponseFromError } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('FoldersAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const { body } = await parseRequest(createFolderContract, request)
    logger.info('Creating folder', { workspaceId: body.workspaceId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return validationErrorResponseFromError(error)
  }
})
```

Routes under `apps/sim/app/api/v1/**` use the shared middleware in `apps/sim/app/api/v1/middleware.ts` for auth, rate-limit, and workspace access. Compose contract validation inside that middleware — never reimplement auth/rate-limit per-route.

## React Query Client Boundary

Hooks in `apps/sim/hooks/queries/**` consume contracts the same way routes do. Every same-origin JSON call must go through `requestJson(contract, ...)` from `@/lib/api/client/request` instead of raw `fetch`:

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
