---
paths:
  - "apps/sim/**/use-*.ts"
  - "apps/sim/**/hooks/**/*.ts"
---

# Hook Patterns

## Structure

For server data, use a React Query hook from `hooks/queries/` — do NOT `useState` + `fetch` here (see `.claude/rules/sim-queries.md`). This pattern is for UI/orchestration hooks that hold UI-only state and wrap callbacks.

```typescript
interface UseFeatureProps {
  id: string
  onSelect?: (item: Item) => void
}

export function useFeature({ id, onSelect }: UseFeatureProps) {
  // 1. Refs for stable dependencies
  const idRef = useRef(id)
  const onSelectRef = useRef(onSelect)

  // 2. UI-only state (never server data)
  const [isOpen, setIsOpen] = useState(false)

  // 3. Sync refs
  useEffect(() => {
    idRef.current = id
    onSelectRef.current = onSelect
  }, [id, onSelect])

  // 4. Operations (useCallback with empty deps when using refs)
  const select = useCallback((item: Item) => {
    onSelectRef.current?.(item)
    setIsOpen(false)
  }, [])

  return { isOpen, setIsOpen, select }
}
```

## Rules

1. Single responsibility per hook
2. Props interface required
3. Refs for stable callback dependencies
4. Wrap returned functions in useCallback
5. Server data goes through React Query (`hooks/queries/`), never `useState` + `fetch`
6. Keep only UI/orchestration state in these hooks

## State shape

Never mirror a prop into state with `useState(prop)` + a syncing `useEffect` — a prop change clobbers in-progress local edits. Use the prop directly, reset via a remount `key`, or — when you must seed local state from a prop only on a transition (e.g. a modal opening) — adjust it **during render** with a `prev`-value tracker held in `useState`:

```typescript
const [prevOpen, setPrevOpen] = useState(open)
if (prevOpen !== open) {
  setPrevOpen(open)
  if (open) setName(initialName) // closed → open only
}
```

React re-renders immediately with the corrected state without committing the stale value. Rules: the `if (prev !== current)` guard is mandatory (an unconditional `setState` in render loops forever), the tracker is set **inside** the guard, and you may only set the currently-rendering component's state this way. Hold the tracker in `useState`, **not a `useRef`** — React forbids reading/writing `ref.current` during render (react.dev, useRef → "Do not write _or read_ `ref.current` during rendering"; the `react-hooks` `refs` lint flags it), and a `useState` tracker is concurrent-safe where a mutated ref is not (a discarded render rolls state back, not a ref).

**The tracker's initial value decides mount behavior — choose it deliberately.** The example seeds `useState(open)` because the modal mounts closed, so the first render's guard is `false` and nothing resets on mount (correct — `name` is already at its initial value). When the effect you're replacing did real work **on mount** — opening a panel because a prop already matches, seeding editable state from an already-present value, or a component that can mount in the active state — seed a **sentinel** the live value can't equal (e.g. `useState<T | null>(null)`), otherwise the guard is `false` on the first render and that mount action is silently dropped. Place the block before any early `return`.

> Some existing components use a `useRef` prev-tracker (`if (prevRef.current !== x) { prevRef.current = x; … }`). It works but reads/writes a ref during render — prefer the `useState` form above for new code.

Only convert a `useState` to a `useRef` when the value is **never read during render/JSX and is never a hook dependency** — a value in a `useEffect`/`useMemo`/`useCallback` dep array must re-run the hook on change, so it stays state (see also `rerender-state-only-in-handlers` in `sim-components.md`). Convert only set-only values read solely inside handlers or effect bodies (e.g. a prompt-history index, a pending-upload URL). If a ref feeds render, mutating it won't re-render and the UI goes stale.

Model mutually-exclusive flags as ONE `status` enum, not several contradictory booleans. `isLoading`/`isVerified`/`isInvalidOtp` describing one machine collapse to `status: 'idle' | 'verifying' | 'verified' | 'error'` (+ `errorMessage`); derive any boolean a consumer still needs (`status === 'error'`).

Derive busy/success from the mutation object — never duplicate `mutation.isPending`/`mutation.isSuccess` into local `useState`. Read them directly (`mutation.isSuccess`) and reset with `mutation.reset()`. A distinct phase the mutation doesn't cover — e.g. a pre-submit captcha/Turnstile gate that runs before `mutate()` — is not a duplicate; keep that flag.
