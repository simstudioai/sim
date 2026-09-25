import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/deployment-status`.
 * `mockCheckNeedsRedeployment` is a bare `vi.fn()` (resolves `undefined`, i.e. falsy) — configure per-test.
 *
 * @example
 * ```ts
 * import { workflowDeploymentStatusMockFns } from '@sim/testing/mocks/workflow-deployment-status.mock'
 *
 * workflowDeploymentStatusMockFns.mockCheckNeedsRedeployment.mockResolvedValue(true)
 * ```
 */
export const workflowDeploymentStatusMockFns = {
  mockCheckNeedsRedeployment: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/deployment-status`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/deployment-status', () => workflowDeploymentStatusMock)
 * ```
 */
export const workflowDeploymentStatusMock = {
  checkNeedsRedeployment: workflowDeploymentStatusMockFns.mockCheckNeedsRedeployment,
}
