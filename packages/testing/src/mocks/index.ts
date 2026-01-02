/**
 * Mock implementations for common dependencies.
 *
 * @example
 * ```ts
 * import { createMockLogger, setupGlobalFetchMock, databaseMock } from '@sim/testing/mocks'
 *
 * // Mock the logger
 * vi.mock('@sim/logger', () => ({ createLogger: () => createMockLogger() }))
 *
 * // Mock fetch globally
 * setupGlobalFetchMock({ json: { success: true } })
 *
 * // Mock database
 * vi.mock('@sim/db', () => databaseMock)
 * ```
 */

// Database mocks
export {
  createMockDb,
  createMockSql,
  createMockSqlOperators,
  databaseMock,
  drizzleOrmMock,
} from './database.mock'
// Env mocks
export { createEnvMock, createMockGetEnv, defaultMockEnv, envMock } from './env.mock'
// Fetch mocks
export {
  createMockFetch,
  createMockResponse,
  createMultiMockFetch,
  type MockFetchResponse,
  mockFetchError,
  mockNextFetchResponse,
  setupGlobalFetchMock,
} from './fetch.mock'
// Logger mocks
export { clearLoggerMocks, createMockLogger, getLoggerCalls, loggerMock } from './logger.mock'
// Socket mocks
export {
  createMockSocket,
  createMockSocketServer,
  type MockSocket,
  type MockSocketServer,
} from './socket.mock'
// Storage mocks
export { clearStorageMocks, createMockStorage, setupGlobalStorageMocks } from './storage.mock'
