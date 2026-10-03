import { vi } from 'vitest'

/**
 * Real `NoActiveDeploymentError` stand-in with the production message and `name`, so
 * `instanceof` against the mocked export and message assertions behave like production.
 */
export class MockNoActiveDeploymentError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} has no active deployment`)
    this.name = 'NoActiveDeploymentError'
  }
}

/**
 * Controllable mock functions for `@/lib/workflows/persistence/utils`.
 * All defaults are bare `vi.fn()` — configure per-test as needed. `mockDeployWorkflow`,
 * `mockActivateWorkflowVersion` and `mockActivateWorkflowVersionById` are kept for existing
 * consumers; the real module no longer exports them.
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
  mockLoadWorkflowDeploymentVersionState: vi.fn(),
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
  mockInvalidateDeployedStateCache: vi.fn(),
  mockMaterializeDeploymentState: vi.fn(),
  mockLoadWorkflowDeploymentSnapshot: vi.fn(),
  mockBuildWorkflowDeploymentSnapshot: vi.fn(),
  mockAdmitWorkflowState: vi.fn(),
  mockSaveAdmittedWorkflowState: vi.fn(),
  mockUpdateDeploymentVersionMetadata: vi.fn(),
  mockFindPreviousDeploymentVersion: vi.fn(),
  mockGetWorkflowDeploymentVersion: vi.fn(),
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
  loadWorkflowDeploymentVersionState:
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowDeploymentVersionState,
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
  invalidateDeployedStateCache: workflowsPersistenceUtilsMockFns.mockInvalidateDeployedStateCache,
  materializeDeploymentState: workflowsPersistenceUtilsMockFns.mockMaterializeDeploymentState,
  loadWorkflowDeploymentSnapshot:
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowDeploymentSnapshot,
  buildWorkflowDeploymentSnapshot:
    workflowsPersistenceUtilsMockFns.mockBuildWorkflowDeploymentSnapshot,
  admitWorkflowState: workflowsPersistenceUtilsMockFns.mockAdmitWorkflowState,
  saveAdmittedWorkflowState: workflowsPersistenceUtilsMockFns.mockSaveAdmittedWorkflowState,
  updateDeploymentVersionMetadata:
    workflowsPersistenceUtilsMockFns.mockUpdateDeploymentVersionMetadata,
  findPreviousDeploymentVersion: workflowsPersistenceUtilsMockFns.mockFindPreviousDeploymentVersion,
  getWorkflowDeploymentVersion: workflowsPersistenceUtilsMockFns.mockGetWorkflowDeploymentVersion,
  NoActiveDeploymentError: MockNoActiveDeploymentError,
  /** Real value: the sub-block ids that hold a credential reference. */
  CREDENTIAL_SUBBLOCK_IDS: new Set([
    'credential',
    'manualCredential',
    'triggerCredentials',
    'customBotCredential',
    'manualBotCredential',
  ]),
}
