---
paths:
  - "apps/sim/hooks/queries/**/*.ts"
---

# React Query Patterns

All React Query hooks live in `hooks/queries/`. All server state must go through React Query — never use `useState` + `fetch` in components for data fetching or mutations.

For *client* view-state that belongs in a shareable link (tabs, filters, search, pagination, selected entity id), use URL query params via nuqs — see `.claude/rules/sim-url-state.md`. React Query owns remote data; nuqs owns shareable client view-state.

## Query Key Factory

Every query file defines a hierarchical keys factory with an `all` root key and intermediate plural keys for prefix-level invalidation:

```typescript
export const entityKeys = {
  all: ['entity'] as const,
  lists: () => [...entityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...entityKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...entityKeys.all, 'detail'] as const,
  detail: (id?: string) => [...entityKeys.details(), id ?? ''] as const,
}
```

Never use inline query keys — always use the factory.

**Every identifier the `queryFn` forwards into the fetch MUST appear in the `queryKey`.** (Query-machinery identifiers — `signal`, `pageParam` — are exempt; they aren't fetch-scoping args.) If the fetch is scoped by `workspaceId`, `cursor`, `limit`, an org id, etc., those values must be part of the key — otherwise distinct fetch args share one cache entry (a cross-tenant / per-param cache collision). The lone exception is a globally-unique id used as the key while a second fetch arg is only an authz scope that cannot collide; annotate those with `// rq-lint-allow: <reason>`. Enforced by the `key-fetch-arg-drift` check in `scripts/check-react-query-patterns.ts`.

## Server-importable query primitives must NOT live in a `'use client'` module

Next.js rewrites **every** export of a `'use client'` module into a *client reference* in the server bundle. Server-evaluated code — RSC `page.tsx`/`layout.tsx`, `prefetch.ts`, route handlers, **block definitions**, triggers/workers — can only *render* such an export as a component or pass it as a prop; **calling** one throws at runtime (`Attempted to call X from the server but X is on the client` — for an object export it surfaces as `X.list is not a function`). `next build` does **not** catch this — only SSR/runtime does.

So any **query-key factory, standalone `requestJson` fetcher, mapper, or constant** that a server module imports must live in a **non-`'use client'`** module:

- key factories → `hooks/queries/utils/<entity>-keys.ts` (see `folder-keys.ts`, `table-keys.ts`, `credential-keys.ts`)
- standalone fetchers/mappers → `hooks/queries/utils/fetch-*.ts` / `*-list-query.ts` (see `fetch-workflow-envelope.ts`, `fetch-credential-set.ts`)

The `'use client'` hook module then imports these back for its hooks. **Never** define a server-imported factory/fetcher directly in a `'use client'` hooks file — it crashes SSR (this caused the tables-page crash). Enforced for prefetch/route/trigger/block files by `scripts/check-client-boundary-imports.ts` (`bun run check:client-boundary`, run in CI). Escape hatch for a genuinely browser-only path: `// client-boundary-allow: <reason>` on the line above the import.

## File Structure

```typescript
// 1. Query keys factory
// 2. Types (if needed)
// 3. Private fetch functions (accept signal parameter)
// 4. Exported hooks
```

## Query Hook

- Every `queryFn` must destructure and forward `signal` for request cancellation
- Every query must have an explicit `staleTime`, assigned from a named exported constant (`ENTITY_LIST_STALE_TIME`), never an inline numeric literal. A server-side prefetch (`prefetch.ts`) hydrating the same query key must import and reuse that constant, not restate the number — this is what keeps a prefetched cache entry from going stale out of sync with the client hook that reads it
- Use `keepPreviousData` only on variable-key queries (where params change), never on static keys
- Same-origin JSON calls must go through `requestJson(contract, ...)` from `@/lib/api/client/request` against the contract in `@/lib/api/contracts/**`

```typescript
import { requestJson } from '@/lib/api/client/request'
import { listEntitiesContract, type EntityList } from '@/lib/api/contracts/entities'

export const ENTITY_LIST_STALE_TIME = 60 * 1000

async function fetchEntities(workspaceId: string, signal?: AbortSignal): Promise<EntityList> {
  const data = await requestJson(listEntitiesContract, {
    query: { workspaceId },
    signal,
  })
  return data.entities
}

export function useEntityList(workspaceId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: entityKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchEntities(workspaceId as string, signal),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: ENTITY_LIST_STALE_TIME,
    placeholderData: keepPreviousData, // OK: workspaceId varies
  })
}
```

## Mutation Hook

- Use targeted invalidation (`entityKeys.lists()`) not broad (`entityKeys.all`) when possible
- Invalidation must cover all affected query key prefixes (lists, details, related views)
- Use `onSuccess` invalidation for plain mutations; use `onSettled` for optimistic mutations so the cache is reconciled on both success and error (see Optimistic Updates below)
- `mutationFn` calls go through `requestJson(contract, { body, signal })` from `@/lib/api/client/request` — same boundary rule as queries

```typescript
export function useCreateEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateEntityBody) => requestJson(createEntityContract, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entityKeys.lists() })
    },
  })
}
```

## Optimistic Updates

For optimistic mutations, use `onSettled` (not `onSuccess`) for cache reconciliation — `onSettled` fires on both success and error, ensuring the cache is always reconciled with the server.

```typescript
export function useUpdateEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables) => { /* ... */ },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: entityKeys.detail(variables.id) })
      const previous = queryClient.getQueryData(entityKeys.detail(variables.id))
      queryClient.setQueryData(entityKeys.detail(variables.id), /* optimistic value */)
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

For optimistic mutations syncing with Zustand, use `createOptimisticMutationHandlers` from `@/hooks/queries/utils/optimistic-mutation`.

## useCallback Dependencies

Never include mutation objects (e.g., `createEntity`) in `useCallback` dependency arrays — the mutation object is not referentially stable and changes on every state update. The `.mutate()` and `.mutateAsync()` functions are stable in TanStack Query v5.

```typescript
// ✗ Bad — causes unnecessary recreations
const handler = useCallback(() => {
  createEntity.mutate(data)
}, [createEntity]) // unstable reference

// ✓ Good — omit from deps, mutate is stable
const handler = useCallback(() => {
  createEntity.mutate(data)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [data])
```

## Boundary Types

- Hooks import named type aliases from `@/lib/api/contracts/**` (e.g., `import { listEntitiesContract, type EntityList } from '@/lib/api/contracts/entities'`). Never write `z.input<...>` / `z.output<...>` in hooks, and never `import { z } from 'zod'` in client code.
- Raw `fetch` is allowed only for documented exceptions — multipart uploads, binary downloads, streaming responses, signed-URL flows, OAuth redirects, external origins. Each such raw `fetch(` inside `apps/sim/hooks/queries/**` or `apps/sim/hooks/selectors/**` — and any same-origin `/api/...` fetch elsewhere under `apps/sim/**` outside an API route handler — must be preceded by a `// boundary-raw-fetch: <reason>` annotation (reason non-empty; up to three preceding comment lines tolerated). Enforced by `scripts/check-api-validation-contracts.ts` (`bun run check:api-validation` / `:strict`).

## Naming

- **Keys**: `entityKeys`
- **Query hooks**: `useEntity`, `useEntityList`
- **Mutation hooks**: `useCreateEntity`, `useUpdateEntity`, `useDeleteEntity`
- **Fetch functions**: `fetchEntity`, `fetchEntities` (private)

## Enforcement

`scripts/check-react-query-patterns.ts` (`bun run check:react-query`, run in CI) statically enforces these conventions: every `useQuery`/`useInfiniteQuery`/`useSuspenseQuery` declares an explicit `staleTime`, inline `queryFn`s destructure `signal`, `queryKey`s reference a colocated factory rather than an inline literal, every `*Keys` factory in `hooks/queries/**` exposes an `all` root key, and every identifier the `queryFn` forwards into the fetch also appears in the `queryKey` (`key-fetch-arg-drift`). `hooks/queries/**` is a zero-tolerance zone; the rest of `apps/sim/**` is ratcheted against `scripts/check-react-query-patterns.baseline.json`. For a genuine exception, put `// rq-lint-allow: <reason>` on the line directly above the flagged construct.
