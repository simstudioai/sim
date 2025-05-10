import { vi } from 'vitest'

// Mock common dependencies used across executor handler tests

// Logger
vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

// Tools
vi.mock('@/tools/utils', () => ({
  getTool: vi.fn(),
  getToolAsync: vi.fn(),
  validateToolRequest: vi.fn(),
  formatRequestParams: vi.fn(),
  transformTable: vi.fn(),
  createParamSchema: vi.fn(),
  getClientEnvVars: vi.fn(),
  createCustomToolRequestBody: vi.fn(),
}))

// Utils
vi.mock('@/lib/utils', () => ({
  isHosted: vi.fn().mockReturnValue(false),
  getRotatingApiKey: vi.fn(),
}))

// Tools
vi.mock('@/tools')

// Providers
vi.mock('@/providers', () => ({
  executeProviderRequest: vi.fn(),
}))
vi.mock('@/providers/utils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    // @ts-ignore
    ...actual,
    getProviderFromModel: vi.fn(),
    transformBlockTool: vi.fn(),
    // Ensure getBaseModelProviders returns an object
    getBaseModelProviders: vi.fn(() => ({})),
  }
})

// Executor utilities
vi.mock('../../path')
vi.mock('../../resolver', () => ({
  InputResolver: vi.fn(),
}))

// Specific block utilities (like router prompt generator)
vi.mock('@/blocks/blocks/router')

// Mock blocks - needed by agent handler for transformBlockTool
vi.mock('@/blocks')

// Mock fetch for server requests
global.fetch = vi.fn()

// Mock process.env
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
