# React & JS Performance Patterns

Hot-path patterns that keep renders cheap and lists fast. These mirror the
`react-doctor` ruleset that runs on the codebase — writing them right the first
time keeps the health score up. Apply in components, hooks, and server
components under `apps/sim/**`.

## Stable references for memo/dep correctness

A value rebuilt every render defeats every `useMemo`/`useCallback` that depends
on it — the memo recomputes every time and child components re-render.

- **Never leave an array/object fallback inline in render** when it feeds a hook
  dep. `const items = raw ?? []` creates a fresh `[]` every render. Wrap the
  whole computation in `useMemo` so the reference is stable:

  ```typescript
  // ✗ Bad — new array identity every render, downstream memos never cache
  const displayChunks = rawChunks ?? []

  // ✓ Good
  const displayChunks = useMemo(() => rawChunks ?? [], [rawChunks])
  ```

  Same for a conditional array (`cond ? a.slice() : []`) or `cond ? x ?? [] : []`
  — memoize it with the inputs as deps.

- **Lazy-init refs — never `useRef(new Set())` / `useRef(new Map())`.** The
  argument is evaluated every render and thrown away. Initialize on first use:

  ```typescript
  // ✗ Bad — allocates a Set every render
  const timers = useRef<Set<Timer>>(new Set())

  // ✓ Good — allocated once
  const timersRef = useRef<Set<Timer> | null>(null)
  timersRef.current ??= new Set()
  // read as `timersRef.current ?? []` in effects/callbacks (ref is dep-exempt)
  ```

- **Hoist pure functions to module scope.** A helper inside a component/hook that
  closes over nothing local is rebuilt every render. Move it out of the
  component so it's defined once.

## One pass, not two — collapse iteration chains

Every chained array method is another full traversal and another intermediate
array. Collapse them:

- `.filter(...).map(...)` / `.map(...).filter(...)` → single `.reduce()` that
  pushes only the kept, transformed items. Preserve order and the exact
  predicate — `reduce` keeps first-seen order like the chain did.

  ```typescript
  // ✗ Bad — two passes, one throwaway array
  const opts = types.filter((t) => hasSlot(t)).map((t) => toOption(t))

  // ✓ Good — one pass
  const opts = types.reduce<Option[]>((acc, t) => {
    if (hasSlot(t)) acc.push(toOption(t))
    return acc
  }, [])
  ```

- `.map(...).filter(Boolean)` → `.flatMap(x => keep ? [value] : [])`.
- `.map(...).filter(...).map(...)` → one `reduce`.

## Map lookups, not `.find()` in a loop

`array.find()` is O(n); calling it inside a loop over the same array is O(n²).
Build a `Map` once before the loop, then do O(1) lookups:

```typescript
// ✗ Bad — O(n²)
for (const slot of slots) {
  const def = definitions.find((d) => d.tagSlot === slot)
}

// ✓ Good — O(n)
const defBySlot = new Map(definitions.map((d) => [d.tagSlot, d]))
for (const slot of slots) {
  const def = defBySlot.get(slot)
}
```

Note the semantic detail: `.find()` returns the **first** match; `Map` built
by `.map(...)` keeps the **last** value for a duplicate key. When keys are
unique (the common case) they're equivalent — but if duplicates are possible and
first-wins matters, build the map with a guard (`if (!m.has(k)) m.set(k, v)`).

## Immutable sort — `toSorted`, not spread + `sort`

`[...arr].sort()` copies the array just to sort it. `apps/sim` targets ES2023,
so use `arr.toSorted(...)` (non-mutating, no manual copy). Packages pinned to
ES2022 (`packages/tsconfig/base.json`) do **not** have `toSorted` — keep
`[...arr].sort()` there.

## Independent awaits run in parallel

Sequential `await`s that don't use each other's result double the wait. In
server components this delays first paint:

```typescript
// ✗ Bad — waits twice
const { id } = await params
const { kbName } = await searchParams

// ✓ Good — one wait
const [{ id }, { kbName }] = await Promise.all([params, searchParams])
```

The same applies to independent data fetches inside a request handler. Only keep
awaits sequential when a later call genuinely consumes an earlier result, or when
sequencing is deliberate (rate-limited batches, retry loops).

## Don't defeat these with false fixes

- A `Date.now()` inside an `onClick`/event handler is fine — it is not a render
  hydration mismatch. Only `Date.now()` reached during render is.
- Don't add a mutation **object** to a `useCallback`/`useMemo` dep array; the
  `.mutate` fn from TanStack Query v5 is already stable (see `sim-queries.md`).
- Memoizing a value that is already primitive/stable adds overhead for nothing —
  memoize arrays, objects, and functions, not booleans or strings.
