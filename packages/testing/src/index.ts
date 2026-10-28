/**
 * @sim/testing - Shared testing utilities for Sim
 *
 * - Factories: Create mock data with sensible defaults
 * - Builders: Fluent APIs for complex test scenarios
 * - Mocks: Reusable mock implementations
 * - Assertions: Semantic test assertions
 * - Helpers: Deferreds, flushes, stream collection, JSON responses, route contexts
 *
 * @example
 * ```ts
 * import { createWorkflowState } from '@sim/testing/factories/workflow.factory'
 * import { authMockFns } from '@sim/testing/mocks/auth.mock'
 * import { createMockRequest } from '@sim/testing/mocks/request.mock'
 * ```
 */

export * from './assertions'
export * from './builders'
export * from './factories'
export * from './helpers'
export * from './mocks'
export * from './types'
