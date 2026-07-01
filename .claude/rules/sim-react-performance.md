# React & Render Performance

Behavior-preserving performance idioms for components, hooks, and hot render paths. These are safe defaults — apply them freely. For the render-causing *effect/state* anti-patterns (derived state in effects, effect chains, state synced to a prop), use the dedicated skills: `/you-might-not-need-an-effect`, `/you-might-not-need-state`, `/you-might-not-need-a-memo`, `/you-might-not-need-a-callback`. Those refactors change render timing — verify them against the running UI, never mass-apply blind.

## Lazy-init refs that hold objects

`useRef(new Map())` / `useRef(new Set())` / `useRef({...})` allocates a fresh object on **every render** and throws it away — only the first is ever kept. Lazy-init instead so the allocation happens once.

```typescript
// ✗ Bad — allocates a new Map each render, discards all but the first
const cacheRef = useRef<Map<string, string>>(new Map())

// ✓ Good — allocated once, stable identity thereafter
const cacheRef = useRef<Map<string, string> | null>(null)
cacheRef.current ??= new Map()
```

Read `cacheRef.current` directly inside effects/handlers — refs are stable and never belong in a dependency array. A cheap primitive (`useRef(0)`, `useRef('')`, `useRef(null)`) needs no lazy init.

## Hoist static values and closure-free functions to module scope

A value or function declared inside a component is rebuilt every render. If it captures **nothing** from component scope (no props/state/refs), move it above the component at module scope. This skips the per-render allocation and keeps a stable identity so memoized children don't re-render.

```typescript
// ✗ Bad — rebuilt every render, new identity each time
function Toolbar({ mode }: ToolbarProps) {
  const TITLES = { create: 'Add', edit: 'Configure' } as const
  const handleWheel = (e: React.WheelEvent) => e.currentTarget.scrollBy(e.deltaX, e.deltaY)
  // ...
}

// ✓ Good — allocated once at module load
const TITLES = { create: 'Add', edit: 'Configure' } as const
function handleWheel(e: React.WheelEvent) {
  e.currentTarget.scrollBy(e.deltaX, e.deltaY)
}
function Toolbar({ mode }: ToolbarProps) { /* ... */ }
```

A closure-free function that IS wired through a ref sink or intentionally kept for stable identity may stay inline — hoisting a one-line `preventDefault` handler is churn, not a win. Hoist when it removes a real per-render allocation or unblocks child memoization.

## Pre-index with Map/Set for repeated lookups

`array.find()` / `array.includes()` / `array.indexOf()` scan the whole list each call. Inside a loop or a hot render path over a non-trivial list, that is O(n·m). Build a `Map` (for lookup-by-key) or `Set` (for membership) **once before** the loop, then look up in O(1).

```typescript
// ✗ Bad — find() re-scans outputs for every column
for (const child of columns) {
  const output = group.outputs.find((o) => o.columnName === getColumnId(child))
}

// ✓ Good — index once, then O(1) lookups
const outputByName = new Map<string, Output>()
for (const o of group.outputs) {
  if (!outputByName.has(o.columnName)) outputByName.set(o.columnName, o) // first wins, matches find()
}
for (const child of columns) {
  const output = outputByName.get(getColumnId(child))
}
```

Preserve `.find()`'s **first-match** semantics when duplicate keys are possible: `new Map(arr.map(...))` keeps the *last* entry, so guard with `if (!map.has(key))` when replacing a `.find()`. Skip this for tiny, cold arrays (a handful of items in an event handler) where the Map build costs more than it saves.

## Never mutate a shared array in place

The real bug to avoid is `array.sort()` / `array.reverse()` on an array you don't own — sorting a React Query cache array in place corrupts shared state. Always sort a copy:

```typescript
// ✗ Bad — mutates the (possibly shared) source array in place
return items.sort(compare)

// ✓ Good — sorts a throwaway copy, source untouched
return [...items].sort(compare)
```

**Do NOT reach for `toSorted()` / `toReversed()` / `with()` / `toSpliced()` on client render paths.** They are ES2023 *runtime* methods — and a tsconfig `"lib": ["ES2023"]` only makes them **type-check**, it does not make them **run**. Next/SWC compiles syntax but does **not** polyfill prototype methods, and the default browserslist still includes browsers without them (`toSorted` landed in Safari 16 / iOS 16, so any device capped at iOS 15 throws `TypeError: x.toSorted is not a function` and crashes the page). The perf difference vs `[...arr].sort()` is negligible (both allocate one array), so the copy-then-sort form is the correct default everywhere client code runs. Only consider the immutable methods in Node-only code (server routes, scripts) on Node ≥20, where the runtime is known.

## Local feature barrels are the convention — do not "fix" them

Tooling (e.g. react-doctor's `no-barrel-import`) will flag imports from local `index.ts` barrels as a bundle cost. In this repo that is a **false positive**: barrel imports for 3+ export folders are mandated by `.claude/rules/sim-imports.md`. Leave them.
