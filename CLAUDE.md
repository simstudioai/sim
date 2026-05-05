# Sim Development Guidelines

## Global Standards

- **Logging**: `createLogger` from `@sim/logger`. Inside `withRouteHandler`, request ID is injected automatically — don't pass it manually
- **API Routes**: Wrap every handler with `withRouteHandler` from `@/lib/core/utils/with-route-handler`. Never export bare `async function GET/POST/...`
- **IDs**: Never `crypto.randomUUID()`, `nanoid`, or `uuid`. Use `generateId()` or `generateShortId()` from `@sim/utils/id`
- **Helpers**: `sleep(ms)` from `@sim/utils/helpers`, `toError(e)` from `@sim/utils/errors`. Don't reimplement
- **Comments**: TSDoc only. No `====` separators, no non-TSDoc comments
- **Styling**: Tailwind only, no inline styles. Use `cn()` from `@/lib/utils`. Never touch global styles
- **Package Manager**: `bun` / `bunx`, never `npm` / `npx`

## TypeScript

- No `any` — use proper types or `unknown` with type guards
- Always define props interface for components
- `as const` for constant objects/arrays

## Imports

Always absolute (`@/...`). Use barrel exports for folders with 3+ exports; otherwise import directly from source. `import type { X }` for type-only.

## API Route Pattern

```typescript
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('MyAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  logger.info('Handling request')
  return NextResponse.json({ ok: true })
})

export const DELETE = withRouteHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  return NextResponse.json({ deleted: id })
})

// withRouteHandler wraps the outermost layer
export const POST = withRouteHandler(withAdminAuth(async (request) => {
  return NextResponse.json({ ok: true })
}))
```

## Zustand Stores

Live in `stores/`. Use `devtools` middleware. Use `persist` only when state must survive reload, with `partialize` to scope what's persisted. Complex stores split into `store.ts` + `types.ts`.

## React Query

All hooks live in `hooks/queries/`. All server state goes through React Query — never `useState` + `fetch` for data fetching or mutations.

### Query key factory

Hierarchical with `all` root and intermediate plural keys for prefix invalidation:

```typescript
export const entityKeys = {
  all: ['entity'] as const,
  lists: () => [...entityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...entityKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...entityKeys.all, 'detail'] as const,
  detail: (id?: string) => [...entityKeys.details(), id ?? ''] as const,
}
```

### Queries

- Every `queryFn` must forward `signal`
- Every query must set explicit `staleTime`
- `keepPreviousData` only on variable-key queries, never on static keys

### Mutations

- Targeted invalidation (`entityKeys.lists()`) over broad (`entityKeys.all`)
- Optimistic updates: reconcile in `onSettled`, not `onSuccess` (fires on error too)
- Don't put mutation objects in `useCallback` deps — `.mutate()` is stable in v5

## EMCN Components

Import from `@/components/emcn`, never subpaths (except CSS). Use CVA when 2+ variants exist.

## Testing

Vitest. `feature.ts` → `feature.test.ts`. See `.claude/rules/sim-testing.md` for full pattern.

### Global mocks (vitest.setup.ts)

`@sim/db`, `drizzle-orm`, `@sim/logger`, `@/blocks/registry`, `@trigger.dev/sdk`, and store mocks are provided globally. Don't re-mock unless overriding behavior.

### Performance rules

- **NEVER** `vi.resetModules()` + `vi.doMock()` + `await import()` — use `vi.hoisted()` + `vi.mock()` + static imports
- **NEVER** `vi.importActual()` — mock everything explicitly
- **NEVER** `mockAuth()`, `mockConsoleLogger()`, `setupCommonApiMocks()` from `@sim/testing` — they use `vi.doMock()` internally
- Mock heavy deps (`@/blocks`, `@/tools/registry`, `@/triggers`) in tests that don't need them
- `@vitest-environment node` unless DOM APIs are needed
- Avoid real timers — 1ms delays or `vi.useFakeTimers()`

Prefer `@sim/testing` mocks/factories over local test data.

## Utils

Don't create `utils.ts` for a single consumer — inline it. Create one when 2+ files need the same helper. Check `lib/` before duplicating.

## Adding Integrations

Use the `add-integration`, `add-block`, `add-tools`, `add-trigger`, or `add-connector` skills. Full reference in `.claude/rules/sim-integrations.md`.

**Critical gotcha:** `tools.config.tool` runs during serialization (before variable resolution). Never do `Number()` or other type coercions there — dynamic references like `<Block.output>` will be destroyed. Put coercions in `tools.config.params` (runs at execution).
