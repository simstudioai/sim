import { vi } from 'vitest'

/**
 * Controllable mocks for the `@sim/workflow-authz` package.
 *
 * @example
 * ```ts
 * import { workflowAuthzMockFns } from '@sim/testing'
 *
 * workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
 *   allowed: true,
 *   status: 200,
 *   workflow: { id: 'wf-1' },
 *   workspacePermission: 'admin',
 * })
 * ```
 */
export const workflowAuthzMockFns = {
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockGetActiveWorkflowContext: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockAssertActiveWorkflowContext: vi.fn(),
}

/**
 * Static mock module for `@sim/workflow-authz`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/workflow-authz', () => workflowAuthzMock)
 * ```
 */
export const workflowAuthzMock = {
  authorizeWorkflowByWorkspacePermission:
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission,
  getActiveWorkflowContext: workflowAuthzMockFns.mockGetActiveWorkflowContext,
  getActiveWorkflowRecord: workflowAuthzMockFns.mockGetActiveWorkflowRecord,
  assertActiveWorkflowContext: workflowAuthzMockFns.mockAssertActiveWorkflowContext,
}
