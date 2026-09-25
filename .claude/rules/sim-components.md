---
description: Component patterns and structure for React components
paths:
  - "apps/sim/**/*.tsx"
---

# Component Patterns

## Structure

```typescript
'use client' // only when the component uses hooks or browser-only APIs

const CONFIG = { SPACING: 8 } as const

interface ComponentProps {
  requiredProp: string
  optionalProp?: boolean
}

export function Component({ requiredProp, optionalProp = false }: ComponentProps) {
  // Order: refs → external hooks → store hooks → custom hooks → state → useMemo → useCallback → useEffect → return
}
```

- Every component has a props interface.
- Extract a piece into its own component when it is 50+ lines, used in 2+ files, or has its own state/logic. Keep it inline when it is under 10 lines, single-use, and purely presentational.
- Prefer semantic HTML (`aside`, `nav`, `article`).
- Optional-chain callbacks: `onAction?.(id)`.

## List-render performance

When rendering or sorting a list of rows against a lookup collection (members, folders, tags), keep the per-row work O(1):

- **Precompute a lookup `Map` once**, never `array.find(...)` per row. Build `const byId = useMemo(() => { const m = new Map<string, T>(); for (const x of items ?? []) m.set(x.id, x); return m }, [items])` and read `byId.get(id)` in the sort comparator, `.map(...)`, and cell builders. A `.find` inside a sort comparator is O(n²·log n) — the worst offender. Depend memos on the derived `Map`, not the raw array.
- **Sort a copy with `[...array].sort(cmp)`**, never `toSorted` in client code — see `sim-react-performance.md` → "Never mutate a shared array in place".
- **Partition in a single pass** — when splitting one collection into several (`fileIds`/`folderIds`), do one `for…of` pushing into each bucket and return `{ a, b }` from a single `useMemo`, not two memos that each `map→filter→map` the same source twice.

## react-doctor (`bunx react-doctor`) — apply the wins, skip the false positives

react-doctor diagnostics are hypotheses, not verdicts — confirm against the code before acting, and preserve behavior. Known repo-specific false positives to NOT "fix":

- `no-barrel-import` — barrel imports are the repo convention (see sim-imports.md, "Barrel Exports"). Keep them.
- `js-tosorted-immutable` — won't-fix in `'use client'` code (see "List-render performance" above); apply it only in server-only modules.
- `rerender-state-only-in-handlers` / "state set but never rendered" — a false positive when the `useState` is consumed by a `useEffect`/`useLayoutEffect` dependency (the effect must re-run on change). Only convert to a ref when nothing reads the value reactively.
- `no-render-in-render` — a helper *called inline* (`{renderRow()}`) is reconciled by position and does **not** remount, so extracting it to a component is usually pure churn and can regress behavior (prop-drilling many closures, focus/scroll loss on the inner `<input>`). Apply it only when the helper is genuinely a *component defined during render*, or when the move is mechanical (a stateless, ref-free helper whose closures become a small, explicit prop set).
- `async-await-in-loop` on an upload/progress loop where sequential execution is intentional (per-item progress, server backpressure) — leave it.
- Broad refactors (`prefer-useReducer` for many `useState`, `no-giant-component` splits) — out of scope for a perf pass; note, don't churn.
