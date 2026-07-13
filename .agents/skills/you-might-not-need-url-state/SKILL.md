---
name: you-might-not-need-url-state
description: Analyze and fix URL/query-param state anti-patterns — manual useSearchParams reads, hand-built query mutations, view-state trapped in useState, and objects in the URL
argument-hint: "[scope] [fix=true|false]"
---

# You Might Not Need URL State

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "app/workspace/[workspaceId]/tables/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Context

Shareable client view-state (active tab/panel, filters, search query, sort, pagination, selected-entity id, an open "view" modal/drawer that is a destination) lives in the URL via [`nuqs`](https://nuqs.dev) — driven by a co-located `search-params.ts`, never read via `useSearchParams().get(...)` and never mutated by hand-built query strings. Remote data stays in React Query; high-frequency / large / ephemeral / socket-synced state stays in Zustand; purely local UI stays in `useState`.

`.claude/rules/sim-url-state.md` is the source of truth — read it first.

## References

Read these before analyzing:
1. `.claude/rules/sim-url-state.md` — the decision framework, conventions, debounced-input pattern, sort convention, selected-entity deep-link pattern, and the workflow-editor carve-out
2. https://nuqs.dev/docs/parsers — parsers (`parseAsString`/`parseAsInteger`/`parseAsBoolean`/`parseAsStringLiteral`/`parseAsArrayOf`/`createParser`)
3. https://nuqs.dev/docs/options — `withDefault`, `history`, `shallow`, `clearOnDefault`
4. https://nuqs.dev/docs/server-side — `createSearchParamsCache` for server reads

## Anti-patterns to detect

1. **Manual param reads for state**: `useSearchParams().get(...)` or `new URLSearchParams(window.location.search)` used to *read* view-state. Replace with `useQueryState`/`useQueryStates` bound to a `search-params.ts`. (Read-once auth/invite/redirect tokens — `token`, `callbackUrl`, `redirect`, `error`, `invite_flow`, `code` — are NOT view-state; leave them on `useSearchParams`.)
2. **Hand-built query mutation**: constructing a query string + `router.replace`/`router.push` to change a param on the current path. Use a nuqs setter. (A `router.push` that changes the route *path* is fine; an outbound `new URLSearchParams` building an `href`/`window.open`/download/API URL is fine.)
3. **`window.history.replaceState`/`pushState`** to mutate a param.
4. **URL state duplicated into a store/useState + synced with an effect** (or a `popstate` listener). The URL is the single source of truth; derive from it, don't mirror it.
5. **Objects in the URL**: serializing a `TableDefinition`/`SkillDefinition`/etc. Store the id and derive the object from the loaded list (`items.find(i => i.id === id)`).
6. **High-frequency / large state in the URL**: cursor, pan/zoom, un-debounced keystrokes, big JSON blobs. Debounce text search (local `useState` mirror + reconcile effect); keep canvas/presence/resize state in Zustand.
7. **Shareable view-state trapped in `useState`**: a tab/filter/sort/pagination/selected-entity that should be a link but lives in local state. Migrate it to the URL.
8. **Missing Suspense boundary**: a component newly calling `useQueryState`/`useQueryStates` whose page entry has no `<Suspense>` wrapper (Next.js requires it for `useSearchParams`). Add one with a real-chrome fallback.
9. **`import { z }` for param validation in client code**: use nuqs parsers instead.

## Steps

1. Read `.claude/rules/sim-url-state.md` and the nuqs docs above to understand the guidelines
2. Analyze the specified scope for the anti-patterns listed above
3. For each finding, decide the correct home using the decision table — do not force URL state onto ephemeral/high-frequency/socket-synced state
4. If fix=true, apply the fixes (co-locate a `search-params.ts`, wire `useQueryState(s)`, add the Suspense boundary, delete the replaced state + sync effects). If fix=false, propose the fixes without applying.
