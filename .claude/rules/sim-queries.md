---
paths:
  - "apps/sim/hooks/queries/**/*.ts"
---

# React Query Patterns

All React Query hooks live in `hooks/queries/`.

## Query Key Factory

Every query file defines a keys factory:

```typescript
export const entityKeys = {
  all: ['entity'] as const,
  list: (workspaceId?: string) => [...entityKeys.all, 'list', workspaceId ?? ''] as const,
  detail: (id?: string) => [...entityKeys.all, 'detail', id ?? ''] as const,
}
```

## File Structure

```typescript
// 1. Query keys factory
// 2. Types (if needed)
// 3. Private fetch functions
// 4. Exported hooks
```

## Query Hook

```typescript
export function useEntityList(workspaceId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: entityKeys.list(workspaceId),
    queryFn: () => fetchEntities(workspaceId as string),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
```

## Mutation Hook

```typescript
export function useCreateEntity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables) => { /* fetch POST */ },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: entityKeys.all }),
  })
}
```

## Optimistic Updates

For optimistic mutations syncing with Zustand, use `createOptimisticMutationHandlers` from `@/hooks/queries/utils/optimistic-mutation`.

## Naming

- **Keys**: `entityKeys`
- **Query hooks**: `useEntity`, `useEntityList`
- **Mutation hooks**: `useCreateEntity`, `useUpdateEntity`
- **Fetch functions**: `fetchEntity` (private)
