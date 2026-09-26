import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/orchestration`.
 * Every function is a bare `vi.fn()` (resolves `undefined`) — configure per-test.
 *
 * @example
 * ```ts
 * import { workflowsOrchestrationMockFns } from '@sim/testing/mocks/workflows-orchestration.mock'
 *
 * workflowsOrchestrationMockFns.mockPerformFullDeploy.mockResolvedValue({ success: true })
 * ```
 */
export const workflowsOrchestrationMockFns = {
  mockPerformChatDeploy: vi.fn(),
  mockPerformChatUndeploy: vi.fn(),
  mockGetWorkflowDeploymentSummary: vi.fn(),
  mockPerformActivateVersion: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockPerformFullUndeploy: vi.fn(),
  mockPerformRevertToVersion: vi.fn(),
  mockDeleteWorkflowRecord: vi.fn(),
  mockPerformCreateWorkflow: vi.fn(),
  mockPerformCreateWorkflowTransition: vi.fn(),
  mockPerformDeleteWorkflow: vi.fn(),
  mockPerformRestoreWorkflow: vi.fn(),
  mockUpdateWorkflowRecord: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/orchestration`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
 * ```
 */
export const workflowsOrchestrationMock = {
  performChatDeploy: workflowsOrchestrationMockFns.mockPerformChatDeploy,
  performChatUndeploy: workflowsOrchestrationMockFns.mockPerformChatUndeploy,
  getWorkflowDeploymentSummary: workflowsOrchestrationMockFns.mockGetWorkflowDeploymentSummary,
  performActivateVersion: workflowsOrchestrationMockFns.mockPerformActivateVersion,
  performFullDeploy: workflowsOrchestrationMockFns.mockPerformFullDeploy,
  performFullUndeploy: workflowsOrchestrationMockFns.mockPerformFullUndeploy,
  performRevertToVersion: workflowsOrchestrationMockFns.mockPerformRevertToVersion,
  deleteWorkflowRecord: workflowsOrchestrationMockFns.mockDeleteWorkflowRecord,
  performCreateWorkflow: workflowsOrchestrationMockFns.mockPerformCreateWorkflow,
  performCreateWorkflowTransition:
    workflowsOrchestrationMockFns.mockPerformCreateWorkflowTransition,
  performDeleteWorkflow: workflowsOrchestrationMockFns.mockPerformDeleteWorkflow,
  performRestoreWorkflow: workflowsOrchestrationMockFns.mockPerformRestoreWorkflow,
  updateWorkflowRecord: workflowsOrchestrationMockFns.mockUpdateWorkflowRecord,
}
