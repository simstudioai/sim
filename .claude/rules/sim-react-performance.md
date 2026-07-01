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

## Immutable array methods over spread-then-mutate

Use `toSorted()` / `toReversed()` / `with()` / `toSpliced()` instead of copying an array only to mutate the copy. One pass instead of copy-then-mutate, and non-mutating by construction (so it never risks mutating a React Query cache array in place — which a bare `.sort()` would).

```typescript
// ✗ Bad — copies just to sort the copy
return [...items].sort(compare)

// ✓ Good — sorts without the throwaway copy, still non-mutating
return items.toSorted(compare)
```

**Lib caveat:** these are ES2023. `apps/sim` sets `"lib": ["ES2023", ...]` in its `tsconfig.json`, so they type-check there. Packages under `packages/*` inherit the **ES2022** base tsconfig — in those, `toSorted` does not resolve; keep `[...arr].sort()`. Check the nearest `tsconfig` `lib` before reaching for these.

## Local feature barrels are the convention — do not "fix" them

Tooling (e.g. react-doctor's `no-barrel-import`) will flag imports from local `index.ts` barrels as a bundle cost. In this repo that is a **false positive**: barrel imports for 3+ export folders are mandated by `.claude/rules/sim-imports.md`. Leave them.
