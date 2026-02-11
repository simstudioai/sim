import {
  drizzleOrmMock,
  loggerMock,
  setupGlobalFetchMock,
  setupGlobalStorageMocks,
} from '@sim/testing'
import { afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

setupGlobalFetchMock()
setupGlobalStorageMocks()

vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/terminal', () => ({
  useTerminalConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
      updateConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      getWorkflowExecution: vi.fn().mockReturnValue({
        isExecuting: false,
        isDebugging: false,
        activeBlockIds: new Set(),
        pendingBlocks: [],
        executor: null,
        debugContext: null,
        lastRunPath: new Map(),
        lastRunEdges: new Map(),
      }),
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
  useLastRunPath: vi.fn().mockReturnValue(new Map()),
  useLastRunEdges: vi.fn().mockReturnValue(new Map()),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => ({})),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: vi.fn(() => ({ trigger: vi.fn() })),
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
