---
paths:
  - "apps/sim/**/store.ts"
  - "apps/sim/**/stores/**/*.ts"
---

# Zustand Store Patterns

Stores live in `stores/`. Complex stores split into `store.ts` + `types.ts`.

## Basic Store

```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { FeatureState } from '@/stores/feature/types'

const initialState = { items: [] as Item[], activeId: null as string | null }

export const useFeatureStore = create<FeatureState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      setItems: (items) => set({ items }),
      addItem: (item) => set((state) => ({ items: [...state.items, item] })),
      reset: () => set(initialState),
    }),
    { name: 'feature-store' }
  )
)
```

## Persisted Store

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useFeatureStore = create<FeatureState>()(
  persist(
    (set) => ({
      width: 300,
      setWidth: (width) => set({ width }),
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
    }),
    {
      name: 'feature-state',
      partialize: (state) => ({ width: state.width }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
)
```

## Rules

1. Use `devtools` middleware (named stores)
2. Use `persist` only when data should survive reload
3. `partialize` to persist only necessary state
4. `_hasHydrated` pattern for persisted stores needing hydration tracking
5. Immutable updates only
6. `set((state) => ...)` when depending on previous state
7. Provide `reset()` action

## Outside React

```typescript
const items = useFeatureStore.getState().items
useFeatureStore.setState({ items: newItems })
```
