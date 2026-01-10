import { loggerMock, setupGlobalFetchMock } from '@sim/testing'
import { vi } from 'vitest'

// Mock common dependencies used across executor handler tests

vi.mock('@sim/logger', () => loggerMock)

// Blocks
vi.mock('@/blocks/index', () => ({
  getBlock: vi.fn(),
}))

// Tools
vi.mock('@/tools/utils', () => ({
  getTool: vi.fn(),
  getToolAsync: vi.fn(),
  validateToolRequest: vi.fn(), // Keep for backward compatibility
  formatRequestParams: vi.fn(),
  transformTable: vi.fn(),
  createParamSchema: vi.fn(),
  getClientEnvVars: vi.fn(),
  createCustomToolRequestBody: vi.fn(),
  validateRequiredParametersAfterMerge: vi.fn(),
}))

// Utils
vi.mock('@/lib/core/config/environment', () => ({
  isHosted: false,
}))

vi.mock('@/lib/core/config/api-keys', () => ({
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
vi.mock('@/executor/path')
vi.mock('@/executor/resolver', () => ({
  InputResolver: vi.fn(),
}))

// Specific block utilities (like router prompt generator)
vi.mock('@/blocks/blocks/router')

// Mock blocks - needed by agent handler for transformBlockTool
vi.mock('@/blocks')

// Mock fetch for server requests
setupGlobalFetchMock()

// Mock process.env
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
