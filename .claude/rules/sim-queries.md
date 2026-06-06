---
paths:
  - "apps/sim/hooks/queries/**/*.ts"
---

# React Query Patterns

All React Query hooks live in `hooks/queries/`. All server state must go through React Query — never use `useState` + `fetch` in components for data fetching or mutations.

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

## File Structure

```typescript
// 1. Query keys factory
// 2. Types (if needed)
// 3. Private fetch functions (accept signal parameter)
// 4. Exported hooks
```

## Query Hook

- Every `queryFn` must destructure and forward `signal` for request cancellation
- Every query must have an explicit `staleTime`
- Use `keepPreviousData` only on variable-key queries (where params change), never on static keys
- Same-origin JSON calls must go through `requestJson(contract, ...)` from `@/lib/api/client/request` against the contract in `@/lib/api/contracts/**`

```typescript
import { requestJson } from '@/lib/api/client/request'
import { listEntitiesContract, type EntityList } from '@/lib/api/contracts/entities'

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
    staleTime: 60 * 1000,
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
