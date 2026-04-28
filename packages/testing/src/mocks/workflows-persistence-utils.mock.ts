import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/persistence/utils`.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { workflowsPersistenceUtilsMockFns } from '@sim/testing'
 *
 * workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
 *   blocks: {},
 *   edges: [],
 *   loops: {},
 *   parallels: {},
 *   isFromNormalizedTables: true,
 * })
 * ```
 */
export const workflowsPersistenceUtilsMockFns = {
  mockBlockExistsInDeployment: vi.fn(),
  mockLoadDeployedWorkflowState: vi.fn(),
  mockMigrateAgentBlocksToMessagesFormat: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockWorkflowExistsInNormalizedTables: vi.fn(),
  mockDeployWorkflow: vi.fn(),
  mockRegenerateWorkflowStateIds: vi.fn(),
  mockUndeployWorkflow: vi.fn(),
  mockActivateWorkflowVersion: vi.fn(),
  mockActivateWorkflowVersionById: vi.fn(),
  mockListWorkflowVersions: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/persistence/utils`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
 * ```
 */
export const workflowsPersistenceUtilsMock = {
  blockExistsInDeployment: workflowsPersistenceUtilsMockFns.mockBlockExistsInDeployment,
  loadDeployedWorkflowState: workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState,
  migrateAgentBlocksToMessagesFormat:
    workflowsPersistenceUtilsMockFns.mockMigrateAgentBlocksToMessagesFormat,
  loadWorkflowFromNormalizedTables:
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables:
    workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables,
  workflowExistsInNormalizedTables:
    workflowsPersistenceUtilsMockFns.mockWorkflowExistsInNormalizedTables,
  deployWorkflow: workflowsPersistenceUtilsMockFns.mockDeployWorkflow,
  regenerateWorkflowStateIds: workflowsPersistenceUtilsMockFns.mockRegenerateWorkflowStateIds,
  undeployWorkflow: workflowsPersistenceUtilsMockFns.mockUndeployWorkflow,
  activateWorkflowVersion: workflowsPersistenceUtilsMockFns.mockActivateWorkflowVersion,
  activateWorkflowVersionById: workflowsPersistenceUtilsMockFns.mockActivateWorkflowVersionById,
  listWorkflowVersions: workflowsPersistenceUtilsMockFns.mockListWorkflowVersions,
}
