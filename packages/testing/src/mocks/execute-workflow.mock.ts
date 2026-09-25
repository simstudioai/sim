import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/executor/execute-workflow`.
 * `mockExecuteWorkflow` is a bare `vi.fn()` (resolves `undefined`) — configure per-test.
 *
 * @example
 * ```ts
 * import { executeWorkflowMockFns } from '@sim/testing/mocks/execute-workflow.mock'
 *
 * executeWorkflowMockFns.mockExecuteWorkflow.mockResolvedValue({ success: true, output: {} })
 * ```
 */
export const executeWorkflowMockFns = {
  mockExecuteWorkflow: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/executor/execute-workflow`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
 * ```
 */
export const executeWorkflowMock = {
  executeWorkflow: executeWorkflowMockFns.mockExecuteWorkflow,
}
