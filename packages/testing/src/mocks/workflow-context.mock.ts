import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/application/context`.
 * All are bare `vi.fn()`s (resolve `undefined`); every consumer sets the canonical workflow context
 * it needs, so there is no safe shared default.
 *
 * @example
 * ```ts
 * import { workflowContextMockFns } from '@sim/testing/mocks/workflow-context.mock'
 *
 * workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
 *   workflowId: 'wf-1', workflow: { id: 'wf-1' }, workspaceId: 'ws-1',
 *   workspaceOrganizationId: null, allowPersonalApiKeys: true, billedAccountUserId: 'user-1',
 * })
 * ```
 */
export const workflowContextMockFns = {
  mockResolveActiveWorkflowApplicationContext: vi.fn(),
  mockResolveArchivedWorkflowApplicationContext: vi.fn(),
  mockResolveActiveWorkflowRunApplicationContext: vi.fn(),
  mockResolveActiveWorkflowExecutionApplicationContext: vi.fn(),
  mockResolveActiveWorkflowDeploymentVersionApplicationContext: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/application/context`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
 * ```
 */
export const workflowContextMock = {
  resolveActiveWorkflowApplicationContext:
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext,
  resolveArchivedWorkflowApplicationContext:
    workflowContextMockFns.mockResolveArchivedWorkflowApplicationContext,
  resolveActiveWorkflowRunApplicationContext:
    workflowContextMockFns.mockResolveActiveWorkflowRunApplicationContext,
  resolveActiveWorkflowExecutionApplicationContext:
    workflowContextMockFns.mockResolveActiveWorkflowExecutionApplicationContext,
  resolveActiveWorkflowDeploymentVersionApplicationContext:
    workflowContextMockFns.mockResolveActiveWorkflowDeploymentVersionApplicationContext,
}
