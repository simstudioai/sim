require('@testing-library/jest-dom')

// Mock global fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
)

// Mock stores
jest.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: jest.fn().mockReturnValue({
      addConsole: jest.fn(),
    }),
  },
}))

jest.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: jest.fn().mockReturnValue({
      setIsExecuting: jest.fn(),
      reset: jest.fn(),
      setActiveBlocks: jest.fn(),
    }),
  },
}))

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks()
})

// Silence specific console errors during tests
const originalConsoleError = console.error
console.error = (...args) => {
  // Filter out expected errors from test output
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  originalConsoleError(...args)
}

// Global setup
beforeAll(() => {
  // Add any global setup here
})

// Global teardown
afterAll(() => {
  // Restore console.error
  console.error = originalConsoleError
})
