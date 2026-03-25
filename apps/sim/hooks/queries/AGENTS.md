# React Query Scope

These rules apply to `apps/sim/hooks/queries/**`.

- All server state must go through React Query; do not use ad hoc `useState` + `fetch` patterns in components for server data.
- Define a query key factory in each file with an `all` root key and intermediate plural keys such as `lists()` and `details()` for prefix invalidation.
- Do not use inline query keys.
- Every `queryFn` must forward `signal` for cancellation.
- Every query must set an explicit `staleTime`.
- Use `keepPreviousData` only for variable-key queries where params change.
- Prefer targeted invalidation such as `entityKeys.lists()` over broad invalidation such as `entityKeys.all`.
- For optimistic updates, reconcile caches in `onSettled`, not only `onSuccess`.
- Do not include stable TanStack mutation objects in `useCallback` deps just to call `.mutate()`.
