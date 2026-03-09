/**
 * Mock utilities for executor handler testing.
 * Sets up common mocks needed for testing executor block handlers.
 *
 * This module is designed to be imported for side effects - the vi.mock calls
 * are executed at the top level and hoisted by vitest.
 *
 * @example
 * ```ts
 * // Import at the very top of your test file for side effects
 * import '@sim/testing/mocks/executor.mock'
 *
 * // Then your other imports
 * import { describe, it, expect } from 'vitest'
 * ```
 */
import { vi } from 'vitest'
import { setupGlobalFetchMock } from './fetch.mock'
import { loggerMock } from './logger.mock'

// Logger
vi.mock('@sim/logger', () => loggerMock)

// Blocks
vi.mock('@/blocks/index', () => ({
  getBlock: vi.fn(),
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
  validateRequiredParametersAfterMerge: vi.fn(),
}))

// Utils
vi.mock('@/lib/core/config/environment', () => ({
  isHosted: false,
}))

vi.mock('@/lib/core/config/api-keys', () => ({
  getRotatingApiKey: vi.fn(),
}))

// Tools module
vi.mock('@/tools')

// Providers
vi.mock('@/providers', () => ({
  executeProviderRequest: vi.fn(),
}))

vi.mock('@/providers/utils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getProviderFromModel: vi.fn(),
    transformBlockTool: vi.fn(),
    getBaseModelProviders: vi.fn(() => ({})),
  }
})

// Executor utilities
vi.mock('@/executor/path')
vi.mock('@/executor/resolver', () => ({
  InputResolver: vi.fn(),
}))
vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
  buildAPIUrl: vi.fn((path: string) => new URL(path, 'http://localhost:3000')),
  extractAPIErrorMessage: vi.fn(async (response: Response) => {
    const defaultMessage = `API request failed with status ${response.status}`
    try {
      const errorData = await response.json()
      return errorData.error || defaultMessage
    } catch {
      return defaultMessage
    }
  }),
}))

// Specific block utilities
vi.mock('@/blocks/blocks/router')

// Mock blocks module
vi.mock('@/blocks')

// Mock fetch for server requests
setupGlobalFetchMock()

// Mock process.env
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
