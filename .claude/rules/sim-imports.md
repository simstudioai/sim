---
description: Import patterns for the Sim application
paths:
  - "apps/sim/**/*.ts"
  - "apps/sim/**/*.tsx"
---

# Import Patterns

## Absolute Imports

**Always use absolute imports.** Never use relative imports, except that a barrel `index.ts` re-exports its own siblings relatively (`export { X } from './x'`). `check:source-conventions` ratchets this per file.

```typescript
// ✓ Good
import { Chip } from '@sim/emcn/button'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

// ✗ Bad
import { useWorkflowStore } from '../../../stores/workflows/workflow/store'
```

## Barrel Exports

Use barrel exports (`index.ts`) when a folder has 3+ exports. Import from barrel, not individual files.

```typescript
// ✓ Good
import { FileViewer, PreviewPanel } from '@/components/file-viewer'

// ✗ Bad
import { FileViewer } from '@/components/file-viewer/file-viewer'
```

## Code-splitting through barrels

When you `lazy(() => import(...))` a component to keep it out of a route's initial bundle, import the **deep module path** (absolute, e.g. `@/app/(product)/.../_components/foo/foo`), never the barrel — and **delete the now-dead barrel re-export** of that component. This app has no `"sideEffects": false` in `apps/sim/package.json`, so when any sibling still imports that barrel, webpack can conservatively keep the barrel's re-export edge to the heavy module. A leftover `export { Foo } from './foo'` line can therefore drag `Foo` (and its transitive deps) back into the initial chunk and silently defeat the split. Removing the dead re-export is the guaranteed fix; verify with a production bundle diff, not by eyeballing the `lazy()` call.

```typescript
// ✓ Good — deep lazy import + no barrel edge left behind
const DashboardEmbed = lazy(() =>
  import(
    '@/components/file-viewer/rich-markdown-editor/dashboard-embed'
  ).then((module) => ({ default: module.DashboardEmbed }))
)
// (and remove any `export { DashboardEmbed } from './dashboard-embed'` from a barrel)
```

Wrap the lazy component in a **local `<Suspense>`** so its suspension resolves at the nearest boundary instead of bubbling to the page-level fallback (which would flash the whole route). `React.lazy(memo(forwardRef(...)))` forwards a DOM `ref` correctly in React 19 — but during the fallback window `ref.current` is `null`, so every consumer must guard it (`if (!el) return` / `el?.`).

## No Re-exports

Do not re-export from non-barrel files. Import directly from the source.

```typescript
// ✓ Good - import from where it's declared
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'

// ✗ Bad - re-exporting in utils.ts then importing from there
import { CORE_TRIGGER_TYPES } from '@/app/(product)/.../utils'
```

## Import Order

Biome's `organizeImports` (`biome.json`) owns import order; `bun run lint` autofixes it.

## Type Imports

Use `type` keyword for type-only imports:

```typescript
import type { CoreTriggerType } from '@/stores/logs/filters/types'
```
