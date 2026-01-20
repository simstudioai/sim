---
paths:
  - "apps/sim/**/*.test.ts"
  - "apps/sim/**/*.test.tsx"
---

# Testing Patterns

Use Vitest. Test files: `feature.ts` → `feature.test.ts`

## Structure

```typescript
/**
 * @vitest-environment node
 */
import { databaseMock, loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

import { myFunction } from '@/lib/feature'

describe('myFunction', () => {
  beforeEach(() => vi.clearAllMocks())
  it.concurrent('isolated tests run in parallel', () => { ... })
})
```

## @sim/testing Package

Always prefer over local mocks.

| Category | Utilities |
|----------|-----------|
| **Mocks** | `loggerMock`, `databaseMock`, `setupGlobalFetchMock()` |
| **Factories** | `createSession()`, `createWorkflowRecord()`, `createBlock()`, `createExecutorContext()` |
| **Builders** | `WorkflowBuilder`, `ExecutionContextBuilder` |
| **Assertions** | `expectWorkflowAccessGranted()`, `expectBlockExecuted()` |

## Rules

1. `@vitest-environment node` directive at file top
2. `vi.mock()` calls before importing mocked modules
3. `@sim/testing` utilities over local mocks
4. `it.concurrent` for isolated tests (no shared mutable state)
5. `beforeEach(() => vi.clearAllMocks())` to reset state

## Hoisted Mocks

For mutable mock references:

```typescript
const mockFn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/module', () => ({ myFunction: mockFn }))
mockFn.mockResolvedValue({ data: 'test' })
```
