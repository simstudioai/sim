# Sim Development Guidelines

You are a professional software engineer. All code must follow best practices: accurate, readable, clean, and efficient.

## Global Standards

- **Logging**: Import `createLogger` from `@sim/logger`. Use `logger.info`, `logger.warn`, `logger.error` instead of `console.log`
- **Comments**: Use TSDoc for documentation. No `====` separators. No non-TSDoc comments
- **Styling**: Never update global styles. Keep all styling local to components
- **Package Manager**: Use `bun` and `bunx`, not `npm` and `npx`

## Architecture

### Core Principles
1. Single Responsibility: Each component, hook, store has one clear purpose
2. Composition Over Complexity: Break down complex logic into smaller pieces
3. Type Safety First: TypeScript interfaces for all props, state, return types
4. Predictable State: Zustand for global state, useState for UI-only concerns

### Root Structure
```
apps/sim/
├── app/           # Next.js app router (pages, API routes)
├── blocks/        # Block definitions and registry
├── components/    # Shared UI (emcn/, ui/)
├── executor/      # Workflow execution engine
├── hooks/         # Shared hooks (queries/, selectors/)
├── lib/           # App-wide utilities
├── providers/     # LLM provider integrations
├── stores/        # Zustand stores
├── tools/         # Tool definitions
└── triggers/      # Trigger definitions
```

### Naming Conventions
- Components: PascalCase (`WorkflowList`)
- Hooks: `use` prefix (`useWorkflowOperations`)
- Files: kebab-case (`workflow-list.tsx`)
- Stores: `stores/feature/store.ts`
- Constants: SCREAMING_SNAKE_CASE
- Interfaces: PascalCase with suffix (`WorkflowListProps`)

## Imports

**Always use absolute imports.** Never use relative imports.

```typescript
// ✓ Good
import { useWorkflowStore } from '@/stores/workflows/store'

// ✗ Bad
import { useWorkflowStore } from '../../../stores/workflows/store'
```

Use barrel exports (`index.ts`) when a folder has 3+ exports. Do not re-export from non-barrel files; import directly from the source.

### Import Order
1. React/core libraries
2. External libraries
3. UI components (`@/components/emcn`, `@/components/ui`)
4. Utilities (`@/lib/...`)
5. Stores (`@/stores/...`)
6. Feature imports
7. CSS imports

Use `import type { X }` for type-only imports.

## TypeScript

1. No `any` - Use proper types or `unknown` with type guards
2. Always define props interface for components
3. `as const` for constant objects/arrays
4. Explicit ref types: `useRef<HTMLDivElement>(null)`

## Components

```typescript
'use client' // Only if using hooks

const CONFIG = { SPACING: 8 } as const

interface ComponentProps {
  requiredProp: string
  optionalProp?: boolean
}

export function Component({ requiredProp, optionalProp = false }: ComponentProps) {
  // Order: refs → external hooks → store hooks → custom hooks → state → useMemo → useCallback → useEffect → return
}
```

Extract when: 50+ lines, used in 2+ files, or has own state/logic. Keep inline when: < 10 lines, single use, purely presentational.

## Hooks

```typescript
interface UseFeatureProps { id: string }

export function useFeature({ id }: UseFeatureProps) {
  const idRef = useRef(id)
  const [data, setData] = useState<Data | null>(null)
  
  useEffect(() => { idRef.current = id }, [id])
  
  const fetchData = useCallback(async () => { ... }, []) // Empty deps when using refs
  
  return { data, fetchData }
}
```

## Zustand Stores

Stores live in `stores/`. Complex stores split into `store.ts` + `types.ts`.

```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

const initialState = { items: [] as Item[] }

export const useFeatureStore = create<FeatureState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      setItems: (items) => set({ items }),
      reset: () => set(initialState),
    }),
    { name: 'feature-store' }
  )
)
```

Use `devtools` middleware. Use `persist` only when data should survive reload with `partialize` to persist only necessary state.

## React Query

All React Query hooks live in `hooks/queries/`.

```typescript
export const entityKeys = {
  all: ['entity'] as const,
  list: (workspaceId?: string) => [...entityKeys.all, 'list', workspaceId ?? ''] as const,
}

export function useEntityList(workspaceId?: string) {
  return useQuery({
    queryKey: entityKeys.list(workspaceId),
    queryFn: () => fetchEntities(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
```

## Styling

Use Tailwind only, no inline styles. Use `cn()` from `@/lib/utils` for conditional classes.

```typescript
<div className={cn('base-classes', isActive && 'active-classes')} />
```

## EMCN Components

Import from `@/components/emcn`, never from subpaths (except CSS files). Use CVA when 2+ variants exist.

## Testing

Use Vitest. Test files: `feature.ts` → `feature.test.ts`

```typescript
/**
 * @vitest-environment node
 */
import { databaseMock, loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

import { myFunction } from '@/lib/feature'

describe('feature', () => {
  beforeEach(() => vi.clearAllMocks())
  it.concurrent('runs in parallel', () => { ... })
})
```

Use `@sim/testing` mocks/factories over local test data. See `.cursor/rules/sim-testing.mdc` for details.

## Utils Rules

- Never create `utils.ts` for single consumer - inline it
- Create `utils.ts` when 2+ files need the same helper
- Check existing sources in `lib/` before duplicating

## Adding Integrations

New integrations require: **Tools** → **Block** → **Icon** → (optional) **Trigger**

Always look up the service's API docs first.

### 1. Tools (`tools/{service}/`)

```
tools/{service}/
├── index.ts      # Barrel export
├── types.ts      # Params/response types
└── {action}.ts   # Tool implementation
```

**Tool structure:**
```typescript
export const serviceTool: ToolConfig<Params, Response> = {
  id: 'service_action',
  name: 'Service Action',
  description: '...',
  version: '1.0.0',
  oauth: { required: true, provider: 'service' },
  params: { /* ... */ },
  request: { url: '/api/tools/service/action', method: 'POST', ... },
  transformResponse: async (response) => { /* ... */ },
  outputs: { /* ... */ },
}
```

Register in `tools/registry.ts`.

### 2. Block (`blocks/blocks/{service}.ts`)

```typescript
export const ServiceBlock: BlockConfig = {
  type: 'service',
  name: 'Service',
  description: '...',
  category: 'tools',
  bgColor: '#hexcolor',
  icon: ServiceIcon,
  subBlocks: [ /* see SubBlock Properties */ ],
  tools: { access: ['service_action'], config: { tool: (p) => `service_${p.operation}` } },
  inputs: { /* ... */ },
  outputs: { /* ... */ },
}
```

Register in `blocks/registry.ts` (alphabetically).

**SubBlock Properties:**
```typescript
{
  id: 'field', title: 'Label', type: 'short-input', placeholder: '...',
  required: true,                    // or condition object
  condition: { field: 'op', value: 'send' },  // show/hide
  dependsOn: ['credential'],         // clear when dep changes
  mode: 'basic',                     // 'basic' | 'advanced' | 'both' | 'trigger'
}
```

**condition examples:**
- `{ field: 'op', value: 'send' }` - show when op === 'send'
- `{ field: 'op', value: ['a','b'] }` - show when op is 'a' OR 'b'
- `{ field: 'op', value: 'x', not: true }` - show when op !== 'x'
- `{ field: 'op', value: 'x', not: true, and: { field: 'type', value: 'dm', not: true } }` - complex

**dependsOn:** `['field']` or `{ all: ['a'], any: ['b', 'c'] }`

**File Input Pattern (basic/advanced mode):**
```typescript
// Basic: file-upload UI
{ id: 'uploadFile', type: 'file-upload', canonicalParamId: 'file', mode: 'basic' },
// Advanced: reference from other blocks
{ id: 'fileRef', type: 'short-input', canonicalParamId: 'file', mode: 'advanced' },
```

In `tools.config.tool`, normalize with:
```typescript
import { normalizeFileInput } from '@/blocks/utils'
const file = normalizeFileInput(params.uploadFile || params.fileRef, { single: true })
if (file) params.file = file
```

For file uploads, create an internal API route (`/api/tools/{service}/upload`) that uses `downloadFileFromStorage` to get file content from `UserFile` objects.

### 3. Icon (`components/icons.tsx`)

```typescript
export function ServiceIcon(props: SVGProps<SVGSVGElement>) {
  return <svg {...props}>/* SVG from brand assets */</svg>
}
```

### 4. Trigger (`triggers/{service}/`) - Optional

```
triggers/{service}/
├── index.ts      # Barrel export
├── webhook.ts    # Webhook handler
└── {event}.ts    # Event-specific handlers
```

Register in `triggers/registry.ts`.

### Integration Checklist

- [ ] Look up API docs
- [ ] Create `tools/{service}/` with types and tools
- [ ] Register tools in `tools/registry.ts`
- [ ] Add icon to `components/icons.tsx`
- [ ] Create block in `blocks/blocks/{service}.ts`
- [ ] Register block in `blocks/registry.ts`
- [ ] (Optional) Create and register triggers
- [ ] (If file uploads) Create internal API route with `downloadFileFromStorage`
- [ ] (If file uploads) Use `normalizeFileInput` in block config
