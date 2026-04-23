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
- `@sim/db/schema` → `schemaMock`
- `drizzle-orm` → `drizzleOrmMock`
- `@sim/logger` → `loggerMock`
- `@/lib/auth` → `authMock`
- `@/lib/auth/hybrid` → `hybridAuthMock` (with default session-delegating behavior)
- `@/lib/core/utils/request` → `requestUtilsMock`
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

## Centralized Mocks (prefer over local declarations)

`@sim/testing` exports ready-to-use mock modules for common dependencies. Import and pass directly to `vi.mock()` — no `vi.hoisted()` boilerplate needed. Each paired `*MockFns` object exposes the underlying `vi.fn()`s for per-test overrides.

| Module mocked | Import | Factory form |
|---|---|---|
| `@/app/api/auth/oauth/utils` | `authOAuthUtilsMock`, `authOAuthUtilsMockFns` | `vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)` |
| `@/app/api/knowledge/utils` | `knowledgeApiUtilsMock`, `knowledgeApiUtilsMockFns` | `vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)` |
| `@/app/api/workflows/utils` | `workflowsApiUtilsMock`, `workflowsApiUtilsMockFns` | `vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)` |
| `@sim/audit` | `auditMock`, `auditMockFns` | `vi.mock('@sim/audit', () => auditMock)` |
| `@/lib/auth` | `authMock`, `authMockFns` | `vi.mock('@/lib/auth', () => authMock)` |
| `@/lib/auth/hybrid` | `hybridAuthMock`, `hybridAuthMockFns` | `vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)` |
| `@/lib/copilot/request/http` | `copilotHttpMock`, `copilotHttpMockFns` | `vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)` |
| `@/lib/core/config/env` | `envMock`, `createEnvMock(overrides)` | `vi.mock('@/lib/core/config/env', () => envMock)` |
| `@/lib/core/config/feature-flags` | `featureFlagsMock` | `vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)` |
| `@/lib/core/config/redis` | `redisConfigMock`, `redisConfigMockFns` | `vi.mock('@/lib/core/config/redis', () => redisConfigMock)` |
| `@/lib/core/security/encryption` | `encryptionMock`, `encryptionMockFns` | `vi.mock('@/lib/core/security/encryption', () => encryptionMock)` |
| `@/lib/core/security/input-validation.server` | `inputValidationMock`, `inputValidationMockFns` | `vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)` |
| `@/lib/core/utils/request` | `requestUtilsMock`, `requestUtilsMockFns` | `vi.mock('@/lib/core/utils/request', () => requestUtilsMock)` |
| `@/lib/core/utils/urls` | `urlsMock`, `urlsMockFns` | `vi.mock('@/lib/core/utils/urls', () => urlsMock)` |
| `@/lib/execution/preprocessing` | `executionPreprocessingMock`, `executionPreprocessingMockFns` | `vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)` |
| `@/lib/logs/execution/logging-session` | `loggingSessionMock`, `loggingSessionMockFns`, `LoggingSessionMock` | `vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)` |
| `@/lib/workflows/orchestration` | `workflowsOrchestrationMock`, `workflowsOrchestrationMockFns` | `vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)` |
| `@/lib/workflows/persistence/utils` | `workflowsPersistenceUtilsMock`, `workflowsPersistenceUtilsMockFns` | `vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)` |
| `@/lib/workflows/utils` | `workflowsUtilsMock`, `workflowsUtilsMockFns` | `vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)` |
| `@/lib/workspaces/permissions/utils` | `permissionsMock`, `permissionsMockFns` | `vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)` |
| `@sim/db/schema` | `schemaMock` | `vi.mock('@sim/db/schema', () => schemaMock)` |

### Auth mocking (API routes)

```typescript
import { authMock, authMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)

import { GET } from '@/app/api/my-route/route'

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
})
```

Only define a local `vi.mock('@/lib/auth', ...)` if the module under test consumes exports outside the centralized shape (e.g., `auth.api.verifyOneTimeToken`, `auth.api.resetPassword`).

### Hybrid auth mocking

```typescript
import { hybridAuthMock, hybridAuthMockFns } from '@sim/testing'

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

// In tests:
hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
  success: true, userId: 'user-1', authType: 'session',
})
```

### Database chain mocking

Use the centralized `dbChainMock` + `dbChainMockFns` helpers — no `vi.hoisted()` or chain-wiring boilerplate needed.

```typescript
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'

vi.mock('@sim/db', () => dbChainMock)
// Spread for custom exports: vi.mock('@sim/db', () => ({ ...dbChainMock, myTable: {...} }))

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock() // only needed if tests use permanent (non-`Once`) overrides
})

it('reads a row', async () => {
  dbChainMockFns.limit.mockResolvedValueOnce([{ id: '1', name: 'test' }])
  // exercise code that hits db.select().from().where().limit()
  expect(dbChainMockFns.where).toHaveBeenCalled()
})
```

**Default chains supported:**
- `select()/selectDistinct()/selectDistinctOn() → from() → where()/innerJoin()/leftJoin() → where() → limit()/orderBy()/returning()/groupBy()/for()`
- `insert() → values() → returning()/onConflictDoUpdate()/onConflictDoNothing()`
- `update() → set() → where() → limit()/orderBy()/returning()/for()`
- `delete() → where() → limit()/orderBy()/returning()/for()`
- `db.execute()` resolves `[]`
- `db.transaction(cb)` calls cb with `dbChainMock.db`

`.for('update')` (Postgres row-level locking) is supported on `where`
builders. It returns a thenable with `.limit` / `.orderBy` / `.returning` /
`.groupBy` attached, so both `await .where().for('update')` (terminal) and
`await .where().for('update').limit(1)` (chained) work. Override the terminal
result with `dbChainMockFns.for.mockResolvedValueOnce([...])`; for the chained
form, mock the downstream terminal (e.g. `dbChainMockFns.limit.mockResolvedValueOnce([...])`).

All terminals default to `Promise.resolve([])`. Override per-test with `dbChainMockFns.<terminal>.mockResolvedValueOnce(...)`.

Use `resetDbChainMock()` in `beforeEach` only when tests replace wiring with `.mockReturnValue` / `.mockResolvedValue` (permanent). Tests using only `...Once` variants don't need it.

## @sim/testing Package

Always prefer over local test data.

| Category | Utilities |
|----------|-----------|
| **Module mocks** | See "Centralized Mocks" table above |
| **Logger helpers** | `loggerMock`, `createMockLogger()`, `getLoggerCalls()`, `clearLoggerMocks()` |
| **Database helpers** | `databaseMock`, `drizzleOrmMock`, `createMockDb()`, `createMockSql()`, `createMockSqlOperators()` |
| **Fetch helpers** | `setupGlobalFetchMock()`, `createMockFetch()`, `createMockResponse()`, `mockFetchError()` |
| **Factories** | `createSession()`, `createWorkflowRecord()`, `createBlock()`, `createExecutionContext()` |
| **Builders** | `WorkflowBuilder`, `ExecutionContextBuilder` |
| **Assertions** | `expectWorkflowAccessGranted()`, `expectBlockExecuted()` |
| **Requests** | `createMockRequest()`, `createMockFormDataRequest()` |

## Rules Summary

1. `@vitest-environment node` unless DOM is required
2. Prefer centralized mocks from `@sim/testing` (see table above) over local `vi.hoisted()` + `vi.mock()` boilerplate
3. `vi.hoisted()` + `vi.mock()` + static imports — never `vi.resetModules()` + `vi.doMock()` + dynamic imports
4. `vi.mock()` calls before importing mocked modules
5. `beforeEach(() => vi.clearAllMocks())` to reset state — no redundant `afterEach`
6. No `vi.importActual()` — mock everything explicitly
7. Mock heavy deps (`@/blocks`, `@/tools/registry`, `@/triggers`) in tests that don't need them
8. Use absolute imports in test files
9. Avoid real timers — use 1ms delays or `vi.useFakeTimers()`
