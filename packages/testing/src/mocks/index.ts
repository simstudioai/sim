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

// API mocks
export {
  mockCommonSchemas,
  mockConsoleLogger,
  mockDrizzleOrm,
  mockKnowledgeSchemas,
  setupCommonApiMocks,
} from './api.mock'
// Audit mocks
export { auditMock } from './audit.mock'
// Auth mocks
export {
  defaultMockUser,
  type MockAuthResult,
  type MockUser,
  mockAuth,
} from './auth.mock'
// Blocks mocks
export {
  blocksMock,
  createMockGetBlock,
  createMockGetTool,
  mockBlockConfigs,
  mockToolConfigs,
  toolsUtilsMock,
} from './blocks.mock'
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
// Executor mocks - use side-effect import: import '@sim/testing/mocks/executor'
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
// Hybrid auth mocks
export { type MockHybridAuthResult, mockHybridAuth } from './hybrid-auth.mock'
// Logger mocks
export { clearLoggerMocks, createMockLogger, getLoggerCalls, loggerMock } from './logger.mock'
// Redis mocks
export { clearRedisMocks, createMockRedis, type MockRedis } from './redis.mock'
// Request mocks
export { createMockFormDataRequest, createMockRequest, requestUtilsMock } from './request.mock'
// Socket mocks
export {
  createMockSocket,
  createMockSocketServer,
  type MockSocket,
  type MockSocketServer,
} from './socket.mock'
// Storage mocks
export { clearStorageMocks, createMockStorage, setupGlobalStorageMocks } from './storage.mock'
// Telemetry mocks
export { telemetryMock } from './telemetry.mock'
// UUID mocks
export { mockCryptoUuid, mockUuid } from './uuid.mock'
