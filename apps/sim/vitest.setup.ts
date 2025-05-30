import { afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Mock global fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
) as any

// Mock console-logger
vi.mock('@/lib/logs/console-logger', () => {
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }))

  return { createLogger }
})

// Mock stores
vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
    }),
  },
}))

// Silence specific console errors during tests
const originalConsoleError = console.error
console.error = (...args: any[]) => {
  // Filter out expected errors from test output
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  originalConsoleError(...args)
}

// Global teardown
afterAll(() => {
  // Restore console.error
  console.error = originalConsoleError
})
