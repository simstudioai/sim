/**
 * Shared Vitest setup file for the testing package.
 *
 * Import this in your vitest.config.ts to get common mocks and setup.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   test: {
 *     setupFiles: ['@sim/testing/setup'],
 *   },
 * })
 * ```
 */

import { afterEach, beforeEach, vi } from 'vitest'
import { setupGlobalFetchMock } from '../mocks/fetch.mock'
import { createMockLogger } from '../mocks/logger.mock'
import { clearStorageMocks, setupGlobalStorageMocks } from '../mocks/storage.mock'

// Setup global storage mocks
setupGlobalStorageMocks()

// Setup global fetch mock with empty JSON response by default
setupGlobalFetchMock({ json: {} })

// Clear mocks between tests
beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  clearStorageMocks()
})

// Export utilities for use in tests
export { createMockLogger }
export { setupGlobalStorageMocks, clearStorageMocks }
export { mockFetchError, mockNextFetchResponse, setupGlobalFetchMock } from '../mocks/fetch.mock'
