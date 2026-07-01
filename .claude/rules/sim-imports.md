---
paths:
  - "apps/sim/**/*.ts"
  - "apps/sim/**/*.tsx"
---

# Import Patterns

## Absolute Imports

**Always use absolute imports.** Never use relative imports.

```typescript
// ✓ Good
import { useWorkflowStore } from '@/stores/workflows/store'
import { Button } from '@/components/ui/button'

// ✗ Bad
import { useWorkflowStore } from '../../../stores/workflows/store'
```

## Barrel Exports

Use barrel exports (`index.ts`) when a folder has 3+ exports. Import from barrel, not individual files.

```typescript
// ✓ Good
import { Dashboard, Sidebar } from '@/app/workspace/[workspaceId]/logs/components'

// ✗ Bad
import { Dashboard } from '@/app/workspace/[workspaceId]/logs/components/dashboard/dashboard'
```

## Code-splitting through barrels

When you `lazy(() => import(...))` a component to keep it out of a route's initial bundle, import the **deep module path** (`./components/foo/foo`), never the barrel — and **delete the now-dead barrel re-export** of that component. This app has no `"sideEffects": false` in `apps/sim/package.json`, so webpack keeps a barrel's re-export edge to the heavy module whenever any sibling still imports that barrel. A leftover `export { Foo } from './foo'` line therefore drags `Foo` (and its transitive deps) back into the initial chunk and silently defeats the split. Verify the split with a production bundle diff, not just by eyeballing the `lazy()` call.

```typescript
// ✓ Good — deep lazy import + no barrel edge left behind
const MothershipView = lazy(() =>
  import('./components/mothership-view/mothership-view').then((m) => ({ default: m.MothershipView }))
)
// (and remove `export { MothershipView } from './mothership-view'` from components/index.ts)
```

Wrap the lazy component in a **local `<Suspense>`** so its suspension resolves at the nearest boundary instead of bubbling to the page-level fallback (which would flash the whole route). `React.lazy(memo(forwardRef(...)))` forwards a DOM `ref` correctly in React 19 — but during the fallback window `ref.current` is `null`, so every consumer must guard it (`if (!el) return` / `el?.`).

## No Re-exports

Do not re-export from non-barrel files. Import directly from the source.

```typescript
// ✓ Good - import from where it's declared
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

// ✗ Bad - re-exporting in utils.ts then importing from there
import { CORE_TRIGGER_TYPES } from '@/app/workspace/.../utils'
```

## Import Order

1. React/core libraries
2. External libraries
3. UI components (`@sim/emcn`, `@/components/ui`)
4. Utilities (`@/lib/...`)
5. Stores (`@/stores/...`)
6. Feature imports
7. CSS imports

## Type Imports

Use `type` keyword for type-only imports:

```typescript
import type { WorkflowLog } from '@/stores/logs/types'
```
