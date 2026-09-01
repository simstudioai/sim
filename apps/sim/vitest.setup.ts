import {
  authMock,
  databaseMock,
  drizzleOrmMock,
  envFlagsMock,
  environmentUtilsMock,
  envMock,
  hybridAuthMock,
  loggerMock,
  redisConfigMock,
  requestUtilsMock,
  schemaMock,
  setupGlobalFetchMock,
  setupGlobalStorageMocks,
  terminalConsoleMock,
  urlsMock,
  workflowAuthzMock,
} from '@sim/testing'
import { afterAll, vi } from 'vitest'

/**
 * jest-dom only registers DOM matchers (`toBeVisible`, `toHaveTextContent`, …),
 * so it is dead weight in a `node` environment — which is 985 of the 1,219 test
 * files here. Loading it unconditionally made every one of them pay for it.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}

setupGlobalFetchMock()
setupGlobalStorageMocks()

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)
vi.mock('@sim/platform-authz/workflow', () => workflowAuthzMock)
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
vi.mock('@/lib/core/utils/request', () => requestUtilsMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/env', () => envMock)
vi.mock('@/lib/core/utils/urls', () => urlsMock)
vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@/lib/environment/utils', () => environmentUtilsMock)

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/terminal', () => terminalConsoleMock)
vi.mock('@/stores/terminal/console/store', () => terminalConsoleMock)

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      getWorkflowExecution: vi.fn().mockReturnValue({
        status: 'idle',
        isExecuting: false,
        isDebugging: false,
        activeBlockIds: new Set(),
        pendingBlocks: [],
        executor: null,
        debugContext: null,
        lastRunPath: new Map(),
        lastRunEdges: new Map(),
      }),
      setStatus: vi.fn(),
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
      setBlockRunStatus: vi.fn(),
      setEdgeRunStatus: vi.fn(),
      clearRunPath: vi.fn(),
    }),
  },
  useCurrentWorkflowExecution: vi.fn().mockReturnValue({
    status: 'idle',
    isExecuting: false,
    isDebugging: false,
    activeBlockIds: new Set(),
    pendingBlocks: [],
    executor: null,
    debugContext: null,
    lastRunPath: new Map(),
    lastRunEdges: new Map(),
  }),
  useIsBlockActive: vi.fn().mockReturnValue(false),
  useIsCurrentWorkflowExecuting: vi.fn().mockReturnValue(false),
  useLastRunPath: vi.fn().mockReturnValue(new Map()),
  useLastRunEdges: vi.fn().mockReturnValue(new Map()),
}))

/**
 * The tool registry is 4,351 entries pulling ~5,907 modules, and almost nothing
 * under test needs the real thing — but every test file that transitively
 * reaches it paid to import the whole graph. Measured on the full suite:
 * import 1,347s -> 633s, transform 130s -> 53s.
 *
 * `@/blocks/registry` is mocked the same way directly below, for the same reason.
 *
 * Tests that genuinely assert registration or tool params opt out with
 * `vi.unmock('@/tools/registry')` at the top of the file — see
 * blocks/blocks/outlook.test.ts for the pattern.
 */
vi.mock('@/tools/registry', () => ({ tools: {} }))

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => []),
  getLatestBlock: vi.fn(() => undefined),
  /** Detail-read accessor: version-resolved and projected through the viewer's visibility. */
  getLatestBlockForViewer: vi.fn(() => undefined),
  /** Catalog projections read a block's presentation meta; the real one returns undefined for unknown types. */
  getBlockMeta: vi.fn(() => undefined),
  /** Mirrors the real module's accessor; without it consumers get "not a function". */
  getBlockRegistry: vi.fn(() => ({})),
  getBlockByToolName: vi.fn((toolName: string) =>
    toolName.startsWith('gmail_')
      ? {
          name: 'Gmail',
          description: 'Gmail integration',
          icon: () => null,
          subBlocks: [],
          outputs: {},
        }
      : undefined
  ),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn(() => ({ trigger: vi.fn() })),
  timeout: { None: 'none' },
  tasks: {
    trigger: vi.fn().mockResolvedValue({ id: 'mock-task-id' }),
    batchTrigger: vi.fn().mockResolvedValue([{ id: 'mock-task-id' }]),
  },
  runs: {
    retrieve: vi.fn().mockResolvedValue({ id: 'mock-run-id', status: 'COMPLETED' }),
  },
  configure: vi.fn(),
}))

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: any[]) => {
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleError(...args)
}

console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleWarn(...args)
}

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
