import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/orchestration`.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { workflowsOrchestrationMockFns } from '@sim/testing'
 *
 * workflowsOrchestrationMockFns.mockPerformFullDeploy.mockResolvedValue({
 *   success: true,
 *   version: 1,
 * })
 * ```
 */
export const workflowsOrchestrationMockFns = {
  mockPerformChatDeploy: vi.fn(),
  mockPerformChatUndeploy: vi.fn(),
  mockNotifySocketDeploymentChanged: vi.fn(),
  mockPerformActivateVersion: vi.fn(),
  mockPerformFullDeploy: vi.fn(),
  mockPerformFullUndeploy: vi.fn(),
  mockPerformRevertToVersion: vi.fn(),
  mockPerformDeleteFolder: vi.fn(),
  mockPerformDeleteWorkflow: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/orchestration`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
 * ```
 */
export const workflowsOrchestrationMock = {
  performChatDeploy: workflowsOrchestrationMockFns.mockPerformChatDeploy,
  performChatUndeploy: workflowsOrchestrationMockFns.mockPerformChatUndeploy,
  notifySocketDeploymentChanged: workflowsOrchestrationMockFns.mockNotifySocketDeploymentChanged,
  performActivateVersion: workflowsOrchestrationMockFns.mockPerformActivateVersion,
  performFullDeploy: workflowsOrchestrationMockFns.mockPerformFullDeploy,
  performFullUndeploy: workflowsOrchestrationMockFns.mockPerformFullUndeploy,
  performRevertToVersion: workflowsOrchestrationMockFns.mockPerformRevertToVersion,
  performDeleteFolder: workflowsOrchestrationMockFns.mockPerformDeleteFolder,
  performDeleteWorkflow: workflowsOrchestrationMockFns.mockPerformDeleteWorkflow,
}
