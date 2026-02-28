---
paths:
  - "apps/sim/**/*.test.ts"
  - "apps/sim/**/*.test.tsx"
---

# Testing Patterns

Use Vitest. Test files: `feature.ts` → `feature.test.ts`

## Global Mocks (vitest.setup.ts)

These modules are mocked globally — do NOT re-mock them in test files unless you need to override behavior:

- `@sim/db` → `databaseMock`
- `drizzle-orm` → `drizzleOrmMock`
- `@sim/logger` → `loggerMock`
- `@/stores/console/store`, `@/stores/terminal`, `@/stores/execution/store`
- `@/blocks/registry`
- `@trigger.dev/sdk`

## Structure

```typescript
/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

import { GET, POST } from '@/app/api/my-route/route'

describe('my route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('returns data', async () => {
    const req = createMockRequest('GET')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
```

## Performance Rules (Critical)

### NEVER use `vi.resetModules()` + `vi.doMock()` + `await import()`

This is the #1 cause of slow tests. It forces complete module re-evaluation per test.

```typescript
// BAD — forces module re-evaluation every test (~50-100ms each)
beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/auth', () => ({ getSession: vi.fn() }))
})
it('test', async () => {
  const { GET } = await import('./route')  // slow dynamic import
})

// GOOD — module loaded once, mocks reconfigured per test (~1ms each)
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
import { GET } from '@/app/api/my-route/route'

beforeEach(() => { vi.clearAllMocks() })
it('test', () => {
  mockGetSession.mockResolvedValue({ user: { id: '1' } })
})
```

**Only exception:** Singleton modules that cache state at module scope (e.g., Redis clients, connection pools). These genuinely need `vi.resetModules()` + dynamic import to get a fresh instance per test.

### NEVER use `vi.importActual()`

This defeats the purpose of mocking by loading the real module and all its dependencies.

```typescript
// BAD — loads real module + all transitive deps
vi.mock('@/lib/workspaces/utils', async () => {
  const actual = await vi.importActual('@/lib/workspaces/utils')
  return { ...actual, myFn: vi.fn() }
})

// GOOD — mock everything, only implement what tests need
vi.mock('@/lib/workspaces/utils', () => ({
  myFn: vi.fn(),
  otherFn: vi.fn(),
}))
```

### NEVER use `mockAuth()`, `mockConsoleLogger()`, or `setupCommonApiMocks()` from `@sim/testing`

These helpers internally use `vi.doMock()` which is slow. Use direct `vi.hoisted()` + `vi.mock()` instead.

### Mock heavy transitive dependencies

If a module under test imports `@/blocks` (200+ files), `@/tools/registry`, or other heavy modules, mock them:

```typescript
vi.mock('@/blocks', () => ({
  getBlock: () => null,
  getAllBlocks: () => ({}),
  getAllBlockTypes: () => [],
  registry: {},
}))
```

### Use `@vitest-environment node` unless DOM is needed

Only use `@vitest-environment jsdom` if the test uses `window`, `document`, `FormData`, or other browser APIs. Node environment is significantly faster.

### Avoid real timers in tests

```typescript
// BAD
await new Promise(r => setTimeout(r, 500))

// GOOD — use minimal delays or fake timers
await new Promise(r => setTimeout(r, 1))
// or
vi.useFakeTimers()
```

## Mock Pattern Reference

### Auth mocking (API routes)

```typescript
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

// In tests:
mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } })
mockGetSession.mockResolvedValue(null) // unauthenticated
```

### Hybrid auth mocking

```typescript
const { mockCheckSessionOrInternalAuth } = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

// In tests:
mockCheckSessionOrInternalAuth.mockResolvedValue({
  success: true, userId: 'user-1', authType: 'session',
})
```

### Database chain mocking

```typescript
const { mockSelect, mockFrom, mockWhere } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect },
}))

beforeEach(() => {
  mockSelect.mockReturnValue({ from: mockFrom })
  mockFrom.mockReturnValue({ where: mockWhere })
  mockWhere.mockResolvedValue([{ id: '1', name: 'test' }])
})
```

## @sim/testing Package

Always prefer over local test data.

| Category | Utilities |
|----------|-----------|
| **Mocks** | `loggerMock`, `databaseMock`, `drizzleOrmMock`, `setupGlobalFetchMock()` |
| **Factories** | `createSession()`, `createWorkflowRecord()`, `createBlock()`, `createExecutionContext()` |
| **Builders** | `WorkflowBuilder`, `ExecutionContextBuilder` |
| **Assertions** | `expectWorkflowAccessGranted()`, `expectBlockExecuted()` |
| **Requests** | `createMockRequest()`, `createEnvMock()` |

## Rules Summary

1. `@vitest-environment node` unless DOM is required
2. `vi.hoisted()` + `vi.mock()` + static imports — never `vi.resetModules()` + `vi.doMock()` + dynamic imports
3. `vi.mock()` calls before importing mocked modules
4. `@sim/testing` utilities over local mocks
5. `beforeEach(() => vi.clearAllMocks())` to reset state — no redundant `afterEach`
6. No `vi.importActual()` — mock everything explicitly
7. No `mockAuth()`, `mockConsoleLogger()`, `setupCommonApiMocks()` — use direct mocks
8. Mock heavy deps (`@/blocks`, `@/tools/registry`, `@/triggers`) in tests that don't need them
9. Use absolute imports in test files
10. Avoid real timers — use 1ms delays or `vi.useFakeTimers()`
