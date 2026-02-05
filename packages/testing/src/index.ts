/**
 * @sim/testing - Shared testing utilities for Sim
 *
 * This package provides a comprehensive set of tools for writing tests:
 * - Factories: Create mock data with sensible defaults
 * - Builders: Fluent APIs for complex test scenarios
 * - Mocks: Reusable mock implementations
 * - Assertions: Semantic test assertions
 *
 * @example
 * ```ts
 * import {
 *   // Factories
 *   createBlock,
 *   createStarterBlock,
 *   createLinearWorkflow,
 *   createExecutionContext,
 *
 *   // Builders
 *   WorkflowBuilder,
 *   ExecutionContextBuilder,
 *
 *   // Assertions
 *   expectBlockExists,
 *   expectEdgeConnects,
 *   expectBlockExecuted,
 * } from '@sim/testing'
 *
 * describe('MyFeature', () => {
 *   it('should work with a linear workflow', () => {
 *     const workflow = createLinearWorkflow(3)
 *     expectBlockExists(workflow.blocks, 'block-0', 'starter')
 *     expectEdgeConnects(workflow.edges, 'block-0', 'block-1')
 *   })
 *
 *   it('should work with a complex workflow', () => {
 *     const workflow = WorkflowBuilder.branching().build()
 *     expectBlockCount(workflow, 5)
 *   })
 * })
 * ```
 */

export * from './assertions'
export * from './builders'
export * from './factories'
export {
  clearRedisMocks,
  createEnvMock,
  createMockDb,
  createMockFetch,
  createMockFormDataRequest,
  createMockGetEnv,
  createMockLogger,
  createMockRedis,
  createMockRequest,
  createMockResponse,
  createMockSocket,
  createMockStorage,
  databaseMock,
  defaultMockEnv,
  defaultMockUser,
  drizzleOrmMock,
  envMock,
  loggerMock,
  type MockAuthResult,
  type MockFetchResponse,
  type MockRedis,
  type MockUser,
  mockAuth,
  mockCommonSchemas,
  mockConsoleLogger,
  mockCryptoUuid,
  mockDrizzleOrm,
  mockKnowledgeSchemas,
  mockUuid,
  setupCommonApiMocks,
  setupGlobalFetchMock,
  setupGlobalStorageMocks,
} from './mocks'
export * from './types'
