---
paths:
  - "apps/sim/**/*.tsx"
---

# Component Patterns

Component authoring rules — structure order (refs → external hooks → store hooks → custom hooks → state → useMemo → useCallback → useEffect → return), required props interface, and extraction thresholds (50+ lines / 2+ files vs keep inline < 10 lines) — live in CLAUDE.md > Components.

`.tsx`-specific deltas not covered there:

- `'use client'` only when using React hooks or browser-only APIs.
- Prefer semantic HTML (`aside`, `nav`, `article`).
- Optional-chain callbacks: `onAction?.(id)`.

## List-render performance

When rendering or sorting a list of rows against a lookup collection (members, folders, tags), keep the per-row work O(1):

- **Precompute a lookup `Map` once**, never `array.find(...)` per row. Build `const byId = useMemo(() => { const m = new Map<string, T>(); for (const x of items ?? []) m.set(x.id, x); return m }, [items])` and read `byId.get(id)` in the sort comparator, `.map(...)`, and cell builders. A `.find` inside a sort comparator is O(n²·log n) — the worst offender. Depend memos on the derived `Map`, not the raw array.
- **Use non-mutating array builtins** — `array.toSorted(cmp)` over `[...array].sort(cmp)` (apps/sim targets ES2023; both are non-mutating but `toSorted` skips the redundant spread copy). Same for `toReversed`/`toSpliced`/`with`.
- **Partition in a single pass** — when splitting one collection into several (`fileIds`/`folderIds`), do one `for…of` pushing into each bucket and return `{ a, b }` from a single `useMemo`, not two memos that each `map→filter→map` the same source twice.

## react-doctor (`npx react-doctor`) — apply the wins, skip the false positives

react-doctor diagnostics are hypotheses, not verdicts — confirm against the code before acting, and preserve behavior. Known repo-specific false positives to NOT "fix":

- `no-barrel-import` — barrel imports are the repo convention (see sim-imports.md, "Barrel Exports"). Keep them.
- `rerender-state-only-in-handlers` / "state set but never rendered" — a false positive when the `useState` is consumed by a `useEffect`/`useLayoutEffect` dependency (the effect must re-run on change). Only convert to a ref when nothing reads the value reactively.
- `async-await-in-loop` on an upload/progress loop where sequential execution is intentional (per-item progress, server backpressure) — leave it.
- Broad refactors (`prefer-useReducer` for many `useState`, `no-giant-component` splits) — out of scope for a perf pass; note, don't churn.
