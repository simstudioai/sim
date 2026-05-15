# Sim Development Guidelines

You are a professional software engineer. All code must follow best practices: accurate, readable, clean, and efficient.

## Global Standards

- **Linting / Audit**: `bun run check:api-validation` must pass on PRs. Do not introduce route-local boundary Zod schemas, direct route Zod imports, or ad-hoc client wire types — see "API Contracts" and "API Route Pattern" below
- **Logging**: Import `createLogger` from `@sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`. Inside API routes wrapped with `withRouteHandler`, loggers automatically include the request ID — no manual `withMetadata({ requestId })` needed
- **API Route Handlers**: All API route handlers (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) must be wrapped with `withRouteHandler` from `@/lib/core/utils/with-route-handler`. This provides request ID tracking, automatic error logging for 4xx/5xx responses, and unhandled error catching. See "API Route Pattern" section below
- **Comments**: Use TSDoc for documentation. No `====` separators. No non-TSDoc comments
- **Styling**: Never update global styles. Keep all styling local to components
- **ID Generation**: Never use `crypto.randomUUID()`, `nanoid`, or `uuid` package. Use `generateId()` (UUID v4) or `generateShortId()` (compact) from `@sim/utils/id`
- **Common Utilities**: Use shared helpers from `@sim/utils` instead of inline implementations. `sleep(ms)` from `@sim/utils/helpers` for delays, `toError(e)` from `@sim/utils/errors` to normalize caught values.
- **Package Manager**: Use `bun` and `bunx`, not `npm` and `npx`

## Architecture

### Core Principles

1. Single Responsibility: Each component, hook, store has one clear purpose
2. Composition Over Complexity: Break down complex logic into smaller pieces
3. Type Safety First: TypeScript interfaces for all props, state, return types
4. Predictable State: Zustand for global state, useState for UI-only concerns

### Root Structure

```
apps/sim/
├── app/           # Next.js app router (pages, API routes)
├── blocks/        # Block definitions and registry
├── components/    # Shared UI (emcn/, ui/)
├── executor/      # Workflow execution engine
├── hooks/         # Shared hooks (queries/, selectors/)
├── lib/           # App-wide utilities
├── providers/     # LLM provider integrations
├── stores/        # Zustand stores
├── tools/         # Tool definitions
└── triggers/      # Trigger definitions
```

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

- `// boundary-raw-fetch: <reason>` — placed on the line directly above a raw `fetch(` call inside `apps/sim/hooks/queries/**` or `apps/sim/hooks/selectors/**`. Use only for documented exceptions: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests
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
- Documented exceptions for raw `fetch`: streaming responses, binary downloads, multipart uploads, signed-URL flows, OAuth redirects, and external-origin requests. Mark each raw `fetch` with a TSDoc comment explaining which exception applies

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

Use Tailwind only, no inline styles. Use `cn()` from `@/lib/utils` for conditional classes.

```typescript
<div className={cn('base-classes', isActive && 'active-classes')} />
```

For equal height and width, use the `size-*` shorthand — never `h-[Npx] w-[Npx]` or `h-N w-N`. Default icon size is `size-[14px]`.

```typescript
<Icon className='size-[14px] text-[var(--text-icon)]' />
```

## EMCN Components

Import from `@/components/emcn`, never from subpaths (except CSS files). Use CVA when 2+ variants exist.

## Testing

Use Vitest. Test files: `feature.ts` → `feature.test.ts`. See `.cursor/rules/sim-testing.mdc` for full details.

### Global Mocks (vitest.setup.ts)

`@sim/db`, `drizzle-orm`, `@sim/logger`, `@/blocks/registry`, `@trigger.dev/sdk`, and store mocks are provided globally. Do NOT re-mock them unless overriding behavior.

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

New integrations require: **Tools** → **Block** → **Icon** → (optional) **Trigger**

Always look up the service's API docs first.

### 1. Tools (`tools/{service}/`)

```
tools/{service}/
├── index.ts      # Barrel export
├── types.ts      # Params/response types
└── {action}.ts   # Tool implementation
```

**Tool structure:**

```typescript
export const serviceTool: ToolConfig<Params, Response> = {
  id: 'service_action',
  name: 'Service Action',
  description: '...',
  version: '1.0.0',
  oauth: { required: true, provider: 'service' },
  params: { /* ... */ },
  request: { url: '/api/tools/service/action', method: 'POST', ... },
  transformResponse: async (response) => { /* ... */ },
  outputs: { /* ... */ },
}
```

Register in `tools/registry.ts`.

### 2. Block (`blocks/blocks/{service}.ts`)

```typescript
export const ServiceBlock: BlockConfig = {
  type: 'service',
  name: 'Service',
  description: '...',
  category: 'tools',
  bgColor: '#hexcolor',
  icon: ServiceIcon,
  subBlocks: [ /* see SubBlock Properties */ ],
  tools: { access: ['service_action'], config: { tool: (p) => `service_${p.operation}`, params: (p) => ({ /* type coercions here */ }) } },
  inputs: { /* ... */ },
  outputs: { /* ... */ },
}
```

Register in `blocks/registry.ts` (alphabetically).

**Important:** `tools.config.tool` runs during serialization (before variable resolution). Never do `Number()` or other type coercions there — dynamic references like `<Block.output>` will be destroyed. Use `tools.config.params` for type coercions (it runs during execution, after variables are resolved).

**SubBlock Properties:**

```typescript
{
  id: 'field', title: 'Label', type: 'short-input', placeholder: '...',
  required: true,                    // or condition object
  condition: { field: 'op', value: 'send' },  // show/hide
  dependsOn: ['credential'],         // clear when dep changes
  mode: 'basic',                     // 'basic' | 'advanced' | 'both' | 'trigger'
}
```

**condition examples:**

- `{ field: 'op', value: 'send' }` - show when op === 'send'
- `{ field: 'op', value: ['a','b'] }` - show when op is 'a' OR 'b'
- `{ field: 'op', value: 'x', not: true }` - show when op !== 'x'
- `{ field: 'op', value: 'x', not: true, and: { field: 'type', value: 'dm', not: true } }` - complex

**dependsOn:** `['field']` or `{ all: ['a'], any: ['b', 'c'] }`

**File Input Pattern (basic/advanced mode):**

```typescript
// Basic: file-upload UI
{ id: 'uploadFile', type: 'file-upload', canonicalParamId: 'file', mode: 'basic' },
// Advanced: reference from other blocks
{ id: 'fileRef', type: 'short-input', canonicalParamId: 'file', mode: 'advanced' },
```

In `tools.config.tool`, normalize with:

```typescript
import { normalizeFileInput } from '@/blocks/utils'
const file = normalizeFileInput(params.uploadFile || params.fileRef, { single: true })
if (file) params.file = file
```

For file uploads, create an internal API route (`/api/tools/{service}/upload`) that uses `downloadFileFromStorage` to get file content from `UserFile` objects.

### 3. Icon (`components/icons.tsx`)

```typescript
export function ServiceIcon(props: SVGProps<SVGSVGElement>) {
  return <svg {...props}>/* SVG from brand assets */</svg>
}
```

### 4. Trigger (`triggers/{service}/`) - Optional

```
triggers/{service}/
├── index.ts      # Barrel export
├── webhook.ts    # Webhook handler
└── {event}.ts    # Event-specific handlers
```

Register in `triggers/registry.ts`.

### Integration Checklist

- Look up API docs
- Create `tools/{service}/` with types and tools
- Register tools in `tools/registry.ts`
- Add icon to `components/icons.tsx`
- Create block in `blocks/blocks/{service}.ts`
- Register block in `blocks/registry.ts`
- (Optional) Create and register triggers
- (If file uploads) Create internal API route with `downloadFileFromStorage`
- (If file uploads) Use `normalizeFileInput` in block config

