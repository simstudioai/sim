# Sim Development Guidelines

You are a professional software engineer. All code must follow best practices: accurate, readable, clean, and efficient.

## Global Standards

- **Linting / Audit**: `bun run check:api-validation` must pass on PRs. Do not introduce route-local boundary Zod schemas, direct route Zod imports, or ad-hoc client wire types — see "API Contracts" and "API Route Pattern" below
- **Logging**: Import `createLogger` from `@sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`. Inside API routes wrapped with `withRouteHandler`, loggers automatically include the request ID — no manual `withMetadata({ requestId })` needed
- **API Route Handlers**: All API route handlers (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) must be wrapped with `withRouteHandler` from `@/lib/core/utils/with-route-handler`. This provides request ID tracking, automatic error logging for 4xx/5xx responses, and unhandled error catching. See "API Route Pattern" section below
- **Comments**: Use TSDoc for documentation. No `====` separators. No non-TSDoc comments
- **Styling**: Never update global styles. Keep all styling local to components
- **ID Generation**: Never use `crypto.randomUUID()`, `nanoid`, or `uuid` package. Use `generateId()` (UUID v4) or `generateShortId()` (compact) from `@sim/utils/id`
- **Common Utilities**: Use shared helpers from `@sim/utils` instead of inline implementations:
  - `sleep(ms)` from `@sim/utils/helpers` — never `new Promise(resolve => setTimeout(resolve, ms))`
  - `toError(e)` from `@sim/utils/errors` — normalize caught values to `Error`
  - `getErrorMessage(e, fallback?)` from `@sim/utils/errors` — extract message string from unknown caught value; never write `e instanceof Error ? e.message : 'fallback'`
  - `structuredClone(value)` — built-in deep clone; never `JSON.parse(JSON.stringify(...))`
  - `omit(obj, keys)` / `filterUndefined(obj)` from `@sim/utils/object` — object trimming; never `Object.fromEntries(Object.entries(...).filter(...))`
  - `truncate(str, maxLength, suffix?)` from `@sim/utils/string` — never inline slice + ellipsis
  - `backoffWithJitter(attempt, retryAfterMs, options?)` / `parseRetryAfter(header)` from `@sim/utils/retry` — shared retry pacing; never reimplement exponential backoff inline
- **Package Manager**: Use `bun` and `bunx`, not `npm` and `npx`

## Architecture

### Core Principles

1. Single Responsibility: Each component, hook, store has one clear purpose
2. Composition Over Complexity: Break down complex logic into smaller pieces
3. Type Safety First: TypeScript interfaces for all props, state, return types
4. Predictable State: Zustand for global state, useState for UI-only concerns

### Root Structure

```
apps/
├── sim/                    # Next.js app (UI + API routes + workflow editor)
│   ├── app/                # Next.js app router (pages, API routes)
│   ├── blocks/             # Block definitions and registry
│   ├── components/         # Shared UI (emcn/, ui/)
│   ├── executor/           # Workflow execution engine
│   ├── hooks/              # Shared hooks (queries/, selectors/)
│   ├── lib/                # App-wide utilities
│   ├── providers/          # LLM provider integrations
│   ├── stores/             # Zustand stores
│   ├── tools/              # Tool definitions
│   └── triggers/           # Trigger definitions
└── realtime/               # Bun Socket.IO server (collaborative canvas)

packages/
├── audit/                  # @sim/audit
├── auth/                   # @sim/auth — shared Better Auth verifier
├── db/                     # @sim/db — drizzle schema + client
├── logger/                 # @sim/logger
├── platform-authz/         # @sim/platform-authz — workspace + workflow authz (subpath exports)
├── realtime-protocol/      # @sim/realtime-protocol — socket op constants + zod schemas
├── security/               # @sim/security — safeCompare
├── tsconfig/               # shared tsconfig presets
├── utils/                  # @sim/utils
├── workflow-persistence/   # @sim/workflow-persistence
└── workflow-types/         # @sim/workflow-types — pure BlockState/Loop/Parallel types
```

### Package boundaries

- `apps/* → packages/*` only. Packages never import from `apps/*`.
- `apps/realtime` intentionally avoids Next.js, React, the block/tool registry, provider SDKs, and the executor. Do not add imports from `@/lib/webhooks/providers/*`, `@/executor/*`, `@/blocks/*`, or `@/tools/*` to any package consumed by `apps/realtime`. CI enforces this via `scripts/check-monorepo-boundaries.ts` and `scripts/check-realtime-prune-graph.ts`.
- Auth is shared across both apps via the Better Auth "Shared Database Session" pattern (same `BETTER_AUTH_SECRET`, same DB via `@sim/db`).

### Naming Conventions

- Components: PascalCase (`WorkflowList`)
- Hooks: `use` prefix (`useWorkflowOperations`)
- Files: kebab-case (`workflow-list.tsx`)
- Stores: `stores/feature/store.ts`
- Constants: SCREAMING_SNAKE_CASE
- Interfaces: PascalCase with suffix (`WorkflowListProps`)

## Imports

**Always use absolute imports.** Never use relative imports.

```typescript
// ✓ Good
import { useWorkflowStore } from '@/stores/workflows/store'

// ✗ Bad
import { useWorkflowStore } from '../../../stores/workflows/store'
```

Use barrel exports (`index.ts`) when a folder has 3+ exports. Do not re-export from non-barrel files; import directly from the source.

### Import Order

1. React/core libraries
2. External libraries
3. UI components (`@/components/emcn`, `@/components/ui`)
4. Utilities (`@/lib/...`)
5. Stores (`@/stores/...`)
6. Feature imports
7. CSS imports

Use `import type { X }` for type-only imports.

## TypeScript

1. No `any` - Use proper types or `unknown` with type guards
2. Always define props interface for components
3. `as const` for constant objects/arrays
4. Explicit ref types: `useRef<HTMLDivElement>(null)`

## Components

```typescript
'use client' // Only if using hooks

const CONFIG = { SPACING: 8 } as const

interface ComponentProps {
  requiredProp: string
  optionalProp?: boolean
}

export function Component({ requiredProp, optionalProp = false }: ComponentProps) {
  // Order: refs → external hooks → store hooks → custom hooks → state → useMemo → useCallback → useEffect → return
}
```

Extract when: 50+ lines, used in 2+ files, or has own state/logic. Keep inline when: < 10 lines, single use, purely presentational.

## API Contracts

Boundary HTTP request and response shapes for all routes under `apps/sim/app/api/**` live in `apps/sim/lib/api/contracts/**` (one file per resource family — `folders.ts`, `chats.ts`, `knowledge.ts`, etc.). Routes never define route-local boundary Zod schemas, and clients never define ad-hoc wire types — both sides consume the same contract.

- Each contract is built with `defineRouteContract({ method, path, params?, query?, body?, headers?, response: { mode: 'json', schema } })` from `@/lib/api/contracts`
- Contracts export named schemas (e.g., `createFolderBodySchema`) AND named TypeScript type aliases (e.g., `export type CreateFolderBody = z.input<typeof createFolderBodySchema>`)
- Clients (hooks, utilities, components) import the named type aliases from the contract file. They must never write `z.input<...>` / `z.output<...>` themselves
- Shared identifier schemas live in `apps/sim/lib/api/contracts/primitives.ts` (e.g., `workspaceIdSchema`, `workflowIdSchema`). Reuse these instead of redefining string-based ID schemas
- Audit script: `bun run check:api-validation` enforces boundary policy and prints ratchet metrics for route Zod imports, route-local schema constructors, route `ZodError` references, client hook Zod imports, and related counters. It must pass on PRs. `bun run check:api-validation:strict` is the strict CI gate and additionally fails on annotations with empty reasons

Domain validators that are not HTTP boundaries — tools, blocks, triggers, connectors, realtime handlers, and internal helpers — may still use Zod directly. The contract rule is boundary-only.

### Boundary annotations

A small number of legitimate exceptions to the boundary rules are tolerated when annotated. The audit script recognizes four annotation forms:

- `// boundary-raw-fetch: <reason>` — placed on the line directly above a raw `fetch(` call in client hooks (`apps/sim/hooks/queries/**`, `apps/sim/hooks/selectors/**`) AND any same-origin `/api/...` fetch elsewhere under `apps/sim/**` outside an API route handler. Use only for documented exceptions: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests
- `// double-cast-allowed: <reason>` — placed on the line directly above an `as unknown as X` cast outside test files
- `// boundary-raw-json: <reason>` — placed on the line directly above a raw `await request.json()` / `await req.json()` read in a route handler. Use only when the body is a JSON-RPC envelope, a tolerant `.catch(() => ({}))` parse, or otherwise cannot go through `parseRequest`
- `// untyped-response: <reason>` — placed on the line directly above a `schema: z.unknown()` response declaration in a contract file. Use only when the response body is genuinely opaque (user-supplied data, third-party passthrough)

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

Every API route handler must be wrapped with `withRouteHandler`. This sets up `AsyncLocalStorage`-based request context so all loggers in the request lifecycle automatically include the request ID.

Routes never `import { z } from 'zod'` and never define route-local boundary schemas. They consume the contract from `@/lib/api/contracts/**` and validate with canonical helpers from `@/lib/api/server`:

- `parseRequest(contract, request, context, options?)` — fully contract-bound routes; parses params, query, body, and headers in one call. Pass `{}` for `context` on routes without route params, or the route's `context` argument when route params exist. Returns a discriminated union; check `parsed.success` and return `parsed.response` on failure
- `validationErrorResponse(error)` and `getValidationErrorMessage(error, fallback)` — produce 400 responses from a `ZodError`
- `validationErrorResponseFromError(error)` — when handling unknown caught errors that may or may not be a `ZodError`
- `isZodError(error)` — type guard. Routes never use `instanceof z.ZodError`

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

### Composing with other middleware

```typescript
export const POST = withRouteHandler(withAdminAuth(async (request) => {
  return NextResponse.json({ ok: true })
}))
```

Routes under `apps/sim/app/api/v1/**` use the shared middleware in `apps/sim/app/api/v1/middleware.ts` for auth, rate-limit, and workspace access. Compose contract validation inside that middleware — never reimplement auth/rate-limit per-route.

Never export a bare `async function GET/POST/...` — always use `export const METHOD = withRouteHandler(...)`.

### Adding a new boundary feature end-to-end

When adding a new route + client surface, follow this order. Each step has one place it lives.

1. **Author the contract first** in `apps/sim/lib/api/contracts/<domain>.ts` (or a subdirectory for large domains: `knowledge/`, `selectors/`, `tools/`). Define one schema per request slice (`params`, `query`, `body`, `headers`) and one for the response, then wrap with `defineRouteContract`. Export named type aliases (`z.input` for inputs, `z.output` for outputs).
2. **Implement the route** in `apps/sim/app/api/<path>/route.ts`. Auth always runs **before** `parseRequest` — never validate untrusted input before authenticating the caller. The route returns exactly the shape declared in `contract.response.schema`.
3. **Add the React Query hook** in `apps/sim/hooks/queries/<domain>.ts`. Use `requestJson(contract, input)` for the call. Build a hierarchical query-key factory (`all` → `lists()` → `list(workspaceId)` → `details()` → `detail(id)`) so invalidations can target prefixes.
4. **Use the hook in the component**. The mutation's `data` and `error` are fully typed from the contract; surface `error.message` (already extracted from the response body's `error` or `message` field by `requestJson`).

### Schema review checklist (read the contract diff like a DB migration)

LLMs will write contracts that compile but are sloppy. The human reviewer should optimize attention on:

- **`required` vs `optional` vs `nullable` is correct**. `optional()` allows omission; `nullable()` allows `null`; chaining both creates a tri-state that's almost never what you want.
- **Response schema matches the route's actual JSON output**. The most common drift bug — route emits a field the schema doesn't declare, or omits a required field. Walk every `NextResponse.json(...)` callsite against the schema.
- **Error messages are descriptive**. `'fileName cannot be empty'` beats `'Required'`. Use the second arg of `min(1, '...')`, `nonempty('...')`, etc. For cross-field refines, use `superRefine` with a `path` and a message that names the failing field.
- **Bounds are set** on arrays (`.min(1)`, `.max(N)`), strings (`.min(1).max(N)` for IDs/names), and numbers (`.min().max()` for limits/sizes).
- **`z.unknown()` is a smell** unless the data is genuinely arbitrary (provider passthrough, user-defined tool result, JSON-RPC envelope). When kept, must be annotated `// untyped-response: <specific reason>` in a `schema:` slot.
- **Discriminated unions over plain unions** when the wire has a discriminant field — gives clients exhaustive narrowing.

CI (`bun run check:api-validation:strict`) catches structural violations (Zod imports in routes, raw `request.json()`, double casts, missing annotations). It does **not** catch these schema-quality judgments — that's the human's job in PR review.

## Hooks

```typescript
interface UseFeatureProps { id: string }

export function useFeature({ id }: UseFeatureProps) {
  const idRef = useRef(id)
  const [data, setData] = useState<Data | null>(null)
  
  useEffect(() => { idRef.current = id }, [id])
  
  const fetchData = useCallback(async () => { ... }, []) // Empty deps when using refs
  
  return { data, fetchData }
}
```

## Zustand Stores

Stores live in `stores/`. Complex stores split into `store.ts` + `types.ts`.

```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

const initialState = { items: [] as Item[] }

export const useFeatureStore = create<FeatureState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      setItems: (items) => set({ items }),
      reset: () => set(initialState),
    }),
    { name: 'feature-store' }
  )
)
```

Use `devtools` middleware. Use `persist` only when data should survive reload with `partialize` to persist only necessary state.

## React Query

All React Query hooks live in `hooks/queries/`. All server state must go through React Query — never use `useState` + `fetch` in components for data fetching or mutations.

### Client Boundary

Hooks consume contracts the same way routes do. Every same-origin JSON call must go through `requestJson(contract, ...)` from `@/lib/api/client/request` instead of raw `fetch`:

- Hooks import named type aliases from `@/lib/api/contracts/**`. Never write `z.input<...>` / `z.output<...>` in hooks, and never `import { z } from 'zod'` in client code
- `requestJson` parses params, query, body, and headers against the contract on the way out and validates the JSON response on the way back. Hooks always forward `signal` for cancellation
- Documented exceptions for raw `fetch`: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests. Mark each raw `fetch` with a TSDoc comment explaining which exception applies. The `// boundary-raw-fetch` annotation is required not only in client hooks but for any same-origin `/api/...` fetch anywhere under `apps/sim/**` outside an API route handler — strict CI flags these regardless of location

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

### Query Key Factory

Every file must have a hierarchical key factory with an `all` root key and intermediate plural keys for prefix invalidation:

```typescript
export const entityKeys = {
  all: ['entity'] as const,
  lists: () => [...entityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...entityKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...entityKeys.all, 'detail'] as const,
  detail: (id?: string) => [...entityKeys.details(), id ?? ''] as const,
}
```

### Query Hooks

- Every `queryFn` must forward `signal` for request cancellation
- Every query must have an explicit `staleTime`
- Use `keepPreviousData` only on variable-key queries (where params change), never on static keys

```typescript
export function useEntityList(workspaceId?: string) {
  return useQuery({
    queryKey: entityKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchEntities(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData, // OK: workspaceId varies
  })
}
```

### Mutation Hooks

- Use targeted invalidation (`entityKeys.lists()`) not broad (`entityKeys.all`) when possible
- For optimistic updates: use `onSettled` (not `onSuccess`) for cache reconciliation — `onSettled` fires on both success and error
- Don't include mutation objects in `useCallback` deps — `.mutate()` is stable in TanStack Query v5

```typescript
export function useUpdateEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables) => { /* ... */ },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: entityKeys.detail(variables.id) })
      const previous = queryClient.getQueryData(entityKeys.detail(variables.id))
      queryClient.setQueryData(entityKeys.detail(variables.id), /* optimistic */)
      return { previous }
    },
    onError: (_err, variables, context) => {
      queryClient.setQueryData(entityKeys.detail(variables.id), context?.previous)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: entityKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entityKeys.detail(variables.id) })
    },
  })
}
```

## Styling

Use Tailwind only, no inline styles. Use `cn()` from `@/lib/core/utils/cn` for conditional classes.

```typescript
<div className={cn('base-classes', isActive && 'active-classes')} />
```

For equal height and width, use the `size-*` shorthand — never `h-[Npx] w-[Npx]` or `h-N w-N`. Default icon size is `size-[14px]`.

```typescript
<Icon className='size-[14px] text-[var(--text-icon)]' />
```

On chip components (see "EMCN Components"), drive chrome through PROPS, not `className`: `error` for the error state, `icon`/`endAdornment` for adornments, `inputClassName` for the inner field. `className` carries ONLY layout/sizing — never re-specify canonical chrome (border, fill, radius, height, text/icon color) or add focus rings. Full consumer rules in `.claude/rules/sim-styling.md`.

## EMCN Components

Import from `@/components/emcn`, never from subpaths (except CSS files). Use CVA only when 2+ genuine variants exist; otherwise plain `cn()`.

The chip family is the canonical UI chrome and is progressively replacing the legacy EMCN primitives — always reach for the chip equivalent: `ChipInput` over `Input`, `ChipTextarea` over `Textarea`, `ChipModal`/`ChipModalField` over `Modal`, `ChipSelect`/`ChipCombobox` (searchable) or `ChipDropdown` (simple menu-select) over `Select`/`Combobox`, `ChipSwitch` over `Switch`, `ChipDatePicker` over a raw date field, `Chip`/`ChipLink` for pill buttons/links, `ChipTag` for inline tags/badges. For context/action menus the canonical control is `DropdownMenu` (not a chip, but the standard menu — not a hand-rolled popover). Components OWN their chrome (single source of truth) — consumers pass props, not class overrides. Authoring rules in `.claude/rules/emcn-components.md`; consumer rules in `.claude/rules/sim-styling.md`.

Inside a `ChipModalBody`, EVERY labeled field MUST be a `ChipModalField` — never hand-roll a field row (a raw `<div>` + a hand-rolled `<p>`/`<label>` title + a bare `ChipInput`/`ChipTextarea`). `ChipModalBody` applies `px-2` + `gap-4`; `ChipModalField` adds ANOTHER `px-2`, so each field lands at effective `px-4`, exactly matching `ChipModalHeader`/`ChipModalFooter` (`px-4`). Hand-rolled rows skip the field's gutter and sit at `px-2`, visibly misaligned with the header/footer. For controls `ChipModalField` does not cover (`ChipCombobox`, `ChipSelect`, `DatePicker`, `TimePicker`, `ButtonGroup`, arbitrary JSX), use `ChipModalField type='custom'` with a `title` — it still applies the `px-2` gutter and renders the canonical `Label`. Drive intent via props (`title`/`value`/`onChange`/`error`/`hint`/`required`/`flush`); never pass `variant`/`className`/`id` to the inner control, and never add a body-level wrapper `<div>` with a custom `gap-*` that fights `ChipModalBody`'s `gap-4`.

## Design-System Consolidation

Principles when building or migrating shared UI:

- One canonical source of truth for shared chrome — compose it, never re-derive it per consumer.
- Props-driven API over `className` overrides — reaching for `className` to change chrome is a smell; expose a prop instead.
- Discriminated-union props for modes (e.g. `ChipDropdown multiple`) over near-duplicate components.
- Delete legacy variants/components after migration — no parallel paths left behind.
- Plain `cn()` for a single error/state toggle; CVA only for genuinely multiple variants.
- Align consumers to the canonical defaults — normal weight, `--text-body` text, `--text-icon` icons.
- Verify referenced CSS vars exist — an undefined var silently falls back to `currentColor` (black-bug).

## Testing

Use Vitest. Test files: `feature.ts` → `feature.test.ts`. See `.cursor/rules/sim-testing.mdc` for full details.

### Global Mocks (vitest.setup.ts)

`@sim/db`, `@sim/db/schema`, `drizzle-orm`, `@sim/logger`, `@sim/platform-authz/workflow`, `@/blocks/registry`, `@/lib/auth`, `@/lib/auth/hybrid`, `@/lib/core/utils/request`, `@trigger.dev/sdk`, and store mocks are provided globally. Do NOT re-mock them unless overriding behavior. (The `vi.mock('@/lib/auth', ...)` in the example below is an override of the global mock so `getSession` can be controlled per-test.)

### Standard Test Pattern

```typescript
/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

import { GET } from '@/app/api/my-route/route'

describe('my route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })
  it('returns data', async () => { ... })
})
```

### Performance Rules

- **NEVER** use `vi.resetModules()` + `vi.doMock()` + `await import()` — use `vi.hoisted()` + `vi.mock()` + static imports
- **NEVER** use `vi.importActual()` — mock everything explicitly
- **NEVER** use `mockAuth()`, `mockConsoleLogger()`, `setupCommonApiMocks()` from `@sim/testing` — they use `vi.doMock()` internally
- **Mock heavy deps** (`@/blocks`, `@/tools/registry`, `@/triggers`) in tests that don't need them
- **Use `@vitest-environment node`** unless DOM APIs are needed (`window`, `document`, `FormData`)
- **Avoid real timers** — use 1ms delays or `vi.useFakeTimers()`

Use `@sim/testing` mocks/factories over local test data.

## Utils Rules

- Never create `utils.ts` for single consumer - inline it
- Create `utils.ts` when 2+ files need the same helper
- Check existing sources in `lib/` before duplicating

## Adding Integrations

New integrations are built in order: **Tools** → **Block** → **Icon** → (optional) **Trigger**. Always look up the service's API docs first.

Two hard rules that the skills assume:

- **Tool IDs are `snake_case`** (`service_action`) and must be registered in `tools/registry.ts`; blocks register in `blocks/registry.ts` (alphabetically).
- **`tools.config.tool` runs during serialization (before variable resolution)** — never do `Number()` or other type coercions there, or dynamic references like `<Block.output>` are destroyed. Put all type coercions in `tools.config.params`, which runs during execution after variables resolve.

For the full authoring instructions — SubBlock property tables, `condition`/`dependsOn`/`required`/`mode`/`canonicalParamId` syntax, required block metadata (`integrationType`, `tags`, `authMode`, `docsLink`, `{Service}BlockMeta`), file-input/`normalizeFileInput` patterns, and checklists — use the skills: `/add-integration` (end-to-end), `/add-tools`, `/add-block`, `/add-trigger`.

