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
 * `vi.mock` factories are hoisted above every import, so the static form only works when this
 * mock's import precedes any import that (transitively) loads the mocked module — otherwise the
 * factory reads `executeWorkflowMock` before initialization. When that ordering cannot be
 * guaranteed, use the async-import form, which resolves the mock inside the factory.
 *
 * @example
 * ```ts
 * import { executeWorkflowMock } from '@sim/testing/mocks/execute-workflow.mock'
 * vi.mock('@/lib/workflows/executor/execute-workflow', () => executeWorkflowMock)
 *
 * vi.mock('@/lib/workflows/executor/execute-workflow', async () =>
 *   (await import('@sim/testing/mocks/execute-workflow.mock')).executeWorkflowMock
 * )
 * ```
 */
export const executeWorkflowMock = {
  executeWorkflow: executeWorkflowMockFns.mockExecuteWorkflow,
}
