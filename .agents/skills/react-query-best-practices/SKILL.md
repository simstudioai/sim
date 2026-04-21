---
name: react-query-best-practices
description: Audit React Query usage for best practices — key factories, staleTime, mutations, and server state ownership
---

# React Query Best Practices

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/hooks/queries/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

This codebase uses React Query (TanStack Query) as the single source of truth for all server state. All query hooks live in `hooks/queries/`. Zustand is used only for client-only UI state. Server data must never be duplicated into useState or Zustand outside of mutation callbacks that coordinate cross-store state.

## References

Read these before analyzing:
1. https://tkdodo.eu/blog/practical-react-query — foundational defaults, custom hooks, avoiding local state copies
2. https://tkdodo.eu/blog/effective-react-query-keys — key factory pattern, hierarchical keys, fuzzy invalidation
3. https://tkdodo.eu/blog/react-query-as-a-state-manager — React Query IS your server state manager

## Rules to enforce

### Query key factories
- Every file in `hooks/queries/` must have a hierarchical key factory with an `all` root key
- Keys must include intermediate plural keys (`lists`, `details`) for prefix invalidation
- Key factories are colocated with their query hooks, not in a global keys file

### Query hooks
- Every `queryFn` must forward `signal` for request cancellation
- Every query must have an explicit `staleTime` (default 0 is almost never correct)
- `keepPreviousData` / `placeholderData` only on variable-key queries (where params change), never on static keys
- Use `enabled` to prevent queries from running without required params

### Mutations
- Use `onSettled` (not `onSuccess`) for cache reconciliation — it fires on both success and error
- For optimistic updates: save previous data in `onMutate`, roll back in `onError`
- Use targeted invalidation (`entityKeys.lists()`) not broad (`entityKeys.all`) when possible
- Don't include mutation objects in `useCallback` deps — `.mutate()` is stable

### Server state ownership
- Never copy query data into useState. Use query data directly in components.
- Never copy query data into Zustand stores (exception: mutation callbacks that coordinate cross-store state like temp ID replacement)
- The query cache is not a local state manager — `setQueryData` is for optimistic updates only
- Forms are the one deliberate exception: copy server data into local form state with `staleTime: Infinity`

## Steps

1. Read the references above to understand the guidelines
2. Analyze the specified scope against the rules listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
