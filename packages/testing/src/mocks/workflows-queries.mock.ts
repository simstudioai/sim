import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/queries`.
 * Every function is a bare `vi.fn()` (resolves `undefined`) — configure per-test.
 *
 * @example
 * ```ts
 * import { workflowsQueriesMockFns } from '@sim/testing/mocks/workflows-queries.mock'
 *
 * workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot.mockResolvedValue(snapshot)
 * ```
 */
export const workflowsQueriesMockFns = {
  mockListWorkspaceWorkflows: vi.fn(),
  mockLoadWorkflowReadSnapshot: vi.fn(),
  mockListWorkflowsForUser: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/queries`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/queries', () => workflowsQueriesMock)
 * ```
 */
export const workflowsQueriesMock = {
  listWorkspaceWorkflows: workflowsQueriesMockFns.mockListWorkspaceWorkflows,
  loadWorkflowReadSnapshot: workflowsQueriesMockFns.mockLoadWorkflowReadSnapshot,
  listWorkflowsForUser: workflowsQueriesMockFns.mockListWorkflowsForUser,
}
