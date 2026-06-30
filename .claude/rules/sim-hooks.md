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

Never mirror a prop into state with `useState(prop)` + a syncing `useEffect` — a prop change clobbers in-progress local edits. Use the prop directly, reset via a remount `key`, or — when you must seed local state from a prop only on a transition (e.g. a modal opening) — reset during render with the `prevX` ref idiom:

```typescript
const prevOpenRef = useRef(open)
if (prevOpenRef.current !== open) {
  prevOpenRef.current = open
  if (open) setName(initialName) // closed → open only
}
```

Model mutually-exclusive flags as ONE `status` enum, not several contradictory booleans. `isLoading`/`isVerified`/`isInvalidOtp` describing one machine collapse to `status: 'idle' | 'verifying' | 'verified' | 'error'` (+ `errorMessage`); derive any boolean a consumer still needs (`status === 'error'`).

Derive busy/success from the mutation object — never duplicate `mutation.isPending`/`mutation.isSuccess` into local `useState`. Read them directly (`mutation.isSuccess`) and reset with `mutation.reset()`. A distinct phase the mutation doesn't cover — e.g. a pre-submit captcha/Turnstile gate that runs before `mutate()` — is not a duplicate; keep that flag.
