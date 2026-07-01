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
- **Sort with `[...array].sort(cmp)` in client code — NOT `array.toSorted(cmp)`.** SWC (Next's compiler) transforms syntax but does not polyfill prototype methods, and the repo sets no core-js/browserslist target, so `toSorted`/`toReversed`/`toSpliced`/`Array.prototype.with` ship as-is and throw `TypeError` on Safari <16 / iOS 15 (they landed in Safari 16). `tsconfig` `lib: ES2023` only affects type-checking, never the runtime. The `[...arr].sort()` spread copy is the intended cost — it keeps the sort non-mutating without an unpolyfilled builtin. These methods are only safe in server-only modules (no `'use client'`, executed on Node ≥20). react-doctor's `js-tosorted-immutable` is therefore a won't-fix in client components.
- **Partition in a single pass** — when splitting one collection into several (`fileIds`/`folderIds`), do one `for…of` pushing into each bucket and return `{ a, b }` from a single `useMemo`, not two memos that each `map→filter→map` the same source twice.

## react-doctor (`npx react-doctor`) — apply the wins, skip the false positives

react-doctor diagnostics are hypotheses, not verdicts — confirm against the code before acting, and preserve behavior. Known repo-specific false positives to NOT "fix":

- `no-barrel-import` — barrel imports are the repo convention (see sim-imports.md, "Barrel Exports"). Keep them.
- `js-tosorted-immutable` — in `'use client'` code, keep `[...arr].sort(cmp)`; `toSorted` is unpolyfilled and crashes Safari <16 / iOS 15 (see "List-render performance" above). Only apply it in server-only modules.
- `rerender-state-only-in-handlers` / "state set but never rendered" — a false positive when the `useState` is consumed by a `useEffect`/`useLayoutEffect` dependency (the effect must re-run on change). Only convert to a ref when nothing reads the value reactively.
- `no-render-in-render` — a helper *called inline* (`{renderRow()}`) is reconciled by position and does **not** remount, so extracting it to a component is usually pure churn and can regress behavior (prop-drilling many closures, focus/scroll loss on the inner `<input>`). Apply it only when the helper is genuinely a *component defined during render*, or when the move is mechanical (a stateless, ref-free helper whose closures become a small, explicit prop set).
- `async-await-in-loop` on an upload/progress loop where sequential execution is intentional (per-item progress, server backpressure) — leave it.
- Broad refactors (`prefer-useReducer` for many `useState`, `no-giant-component` splits) — out of scope for a perf pass; note, don't churn.
