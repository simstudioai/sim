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

// Audit mocks
export { auditMock, auditMockFns } from './audit.mock'
// Auth mocks
export { authMock, authMockFns, type MockUser } from './auth.mock'
// Auth OAuth utils mocks (for @/app/api/auth/oauth/utils)
export {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  ServiceAccountTokenErrorMock,
} from './auth-oauth-utils.mock'
// Blocks mocks
export {
  blocksMock,
  createMockGetBlock,
  createMockGetTool,
  mockBlockConfigs,
  mockToolConfigs,
  toolsUtilsMock,
} from './blocks.mock'
// Copilot HTTP mocks (for @/lib/copilot/request/http)
export { copilotHttpMock, copilotHttpMockFns } from './copilot-http.mock'
// Database mocks
export {
  createMockDb,
  createMockSql,
  createMockSqlOperators,
  databaseMock,
  dbChainMock,
  dbChainMockFns,
  drizzleOrmMock,
  resetDbChainMock,
} from './database.mock'
// Encryption mocks
export { encryptionMock, encryptionMockFns } from './encryption.mock'
// Env mocks
export { createEnvMock, createMockGetEnv, defaultMockEnv, envMock } from './env.mock'
// Execution preprocessing mocks (for @/lib/execution/preprocessing)
export {
  executionPreprocessingMock,
  executionPreprocessingMockFns,
} from './execution-preprocessing.mock'
// Feature flag mocks
export { featureFlagsMock } from './feature-flags.mock'
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
export { hybridAuthMock, hybridAuthMockFns } from './hybrid-auth.mock'
// Input validation mocks
export { inputValidationMock, inputValidationMockFns } from './input-validation.mock'
// Knowledge API utils mocks (for @/app/api/knowledge/utils)
export { knowledgeApiUtilsMock, knowledgeApiUtilsMockFns } from './knowledge-api-utils.mock'
// Logger mocks
export { clearLoggerMocks, createMockLogger, getLoggerCalls, loggerMock } from './logger.mock'
// Logging session mocks (for @/lib/logs/execution/logging-session)
export {
  LoggingSessionMock,
  loggingSessionMock,
  loggingSessionMockFns,
} from './logging-session.mock'
// Permission mocks
export { permissionsMock, permissionsMockFns } from './permissions.mock'
// Redis client mocks (for Redis client objects)
export { clearRedisMocks, createMockRedis, type MockRedis } from './redis.mock'
// Redis config mocks (for @/lib/core/config/redis)
export { redisConfigMock, redisConfigMockFns } from './redis-config.mock'
// Request mocks
export {
  createMockFormDataRequest,
  createMockRequest,
  requestUtilsMock,
  requestUtilsMockFns,
} from './request.mock'
// Schema mocks
export { schemaMock } from './schema.mock'
// Socket mocks
export {
  createMockSocket,
  createMockSocketServer,
  type MockSocket,
  type MockSocketServer,
} from './socket.mock'
// Storage mocks
export { clearStorageMocks, createMockStorage, setupGlobalStorageMocks } from './storage.mock'
// Stripe mocks
export {
  createMockStripeEvent,
  stripeClientMock,
  stripeClientMockFns,
  stripePaymentMethodMock,
  stripePaymentMethodMockFns,
} from './stripe.mock'
// Telemetry mocks
export { telemetryMock } from './telemetry.mock'
// URL mocks
export { urlsMock, urlsMockFns } from './urls.mock'
// Workflow authz package mocks (for @sim/workflow-authz)
export { workflowAuthzMock, workflowAuthzMockFns } from './workflow-authz.mock'
// Workflows API utils mocks (for @/app/api/workflows/utils)
export { workflowsApiUtilsMock, workflowsApiUtilsMockFns } from './workflows-api-utils.mock'
// Workflows orchestration mocks (for @/lib/workflows/orchestration)
export {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from './workflows-orchestration.mock'
// Workflows persistence utils mocks (for @/lib/workflows/persistence/utils)
export {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from './workflows-persistence-utils.mock'
// Workflows-utils mocks
export { workflowsUtilsMock, workflowsUtilsMockFns } from './workflows-utils.mock'
