---
name: react-query-best-practices
description: Audit React Query usage for best practices — key factories, staleTime, mutations, and server state ownership
argument-hint: "[scope] [fix=true|false]"
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

### Query keys and hooks
Enforce CLAUDE.md "React Query" and `.claude/rules/sim-queries.md` (key factory with `all` + plural prefixes, `signal` forwarding, named `staleTime` constants reused by prefetches, `keepPreviousData` only on variable keys, `requestJson` boundary). Additionally:
- Key factories live next to their hooks — except a factory (or standalone fetcher/mapper) that a server module imports, which must live in `hooks/queries/utils/<entity>-keys.ts` / `fetch-*.ts` per `.claude/rules/sim-queries.md` (a `'use client'` export called from the server crashes SSR)
- Use `enabled` to prevent queries from running without required params
- Warm data for hover/focus intent with `queryClient.prefetchQuery` and shared `queryOptions`; never temporarily enable a mounted hidden observer, which can remain active after focus restoration and refetch data for closed UI
- When gating a query by view or modal state, move every consumer to the active query too: imperative refresh/pagination, loading and error feedback, and data-derived controls must never read a disabled query or placeholder data from a previous key
- Compose caller-controlled `enabled` options with required-param guards (`Boolean(id) && (options?.enabled ?? true)`). Never spread options after an internal guard, because `{ enabled: true }` can silently re-enable an invalid request.
- A disabled query can still report `isPending: true`. Aggregate loading state only for queries that are applicable/enabled, or an optional query can hold the whole surface in a permanent loading state.
- Deferred authorization or policy queries must fail closed. Do not give pending/error data the same fallback as a successfully loaded unrestricted policy; disable guarded actions until the policy query succeeds.
- Server prefetches must call the authorized use case, apply the route presenter/response schema, and reuse the client's exact key, mapper, and stale time. Keep all fallible auth/read/parse work inside `queryFn` so an optional warm cannot fail the page, and never bypass a route that redacts fields.

### Mutations
Enforce CLAUDE.md "Mutation Hooks" (targeted invalidation, `onMutate`/`onError` rollback, mutation objects out of `useCallback` deps). Additionally:
- Plain mutations invalidate in `onSuccess`; optimistic mutations reconcile in `onSettled` (fires on success and error) with rollback in `onError` — see `.claude/rules/sim-queries.md` "Mutation Hook" / "Optimistic Updates"

### Server state ownership
- Never copy query data into useState. Use query data directly in components.
- Never copy query data into Zustand stores (exception: mutation callbacks that coordinate cross-store state like temp ID replacement)
- The query cache is not a local state manager — `setQueryData` is for optimistic updates and the server-prefetch seeding case in `.claude/rules/sim-queries.md` "Server prefetching", nothing else
- Forms are the one deliberate exception (a keyed form child initialized lazily from loaded query data) — the pattern is owned by `/you-might-not-need-an-effect` "Query-backed forms"; do not duplicate its finding

## Steps

1. Read the references above to understand the guidelines
2. Analyze the specified scope against the rules listed above
3. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
