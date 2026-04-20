import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/workflows/utils`.
 * Use these references in tests to configure return values and assert calls.
 *
 * @example
 * ```ts
 * import { workflowsUtilsMockFns } from '@sim/testing'
 *
 * workflowsUtilsMockFns.mockGetWorkflowById.mockResolvedValue({ id: 'wf-1', name: 'Test' })
 * ```
 */
export const workflowsUtilsMockFns = {
  mockGetWorkflowById: vi.fn(),
  mockListWorkflows: vi.fn(),
  mockDeduplicateWorkflowName: vi.fn(),
  mockResolveWorkflowIdForUser: vi.fn(),
  mockUpdateWorkflowRunCounts: vi.fn(),
  mockWorkflowHasResponseBlock: vi.fn(),
  mockCreateHttpResponseFromBlock: vi.fn(),
  mockValidateWorkflowPermissions: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockCreateWorkflowRecord: vi.fn(),
  mockUpdateWorkflowRecord: vi.fn(),
  mockDeleteWorkflowRecord: vi.fn(),
  mockSetWorkflowVariables: vi.fn(),
  mockCreateFolderRecord: vi.fn(),
  mockUpdateFolderRecord: vi.fn(),
  mockDeleteFolderRecord: vi.fn(),
  mockCheckForCircularReference: vi.fn(),
  mockListFolders: vi.fn(),
}

/**
 * Static mock module for `@/lib/workflows/utils`.
 * Use with `vi.mock()` to replace the real module in tests.
 *
 * Default behaviors:
 * - `getWorkflowById` resolves to `null`
 * - `authorizeWorkflowByWorkspacePermission` resolves to allowed with `test-workspace-id`
 * - `validateWorkflowPermissions` resolves to an authorized result
 * - Other functions resolve to sensible empty/success defaults
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)
 * ```
 */
export const workflowsUtilsMock = {
  getWorkflowById: workflowsUtilsMockFns.mockGetWorkflowById,
  listWorkflows: workflowsUtilsMockFns.mockListWorkflows,
  deduplicateWorkflowName: workflowsUtilsMockFns.mockDeduplicateWorkflowName,
  resolveWorkflowIdForUser: workflowsUtilsMockFns.mockResolveWorkflowIdForUser,
  updateWorkflowRunCounts: workflowsUtilsMockFns.mockUpdateWorkflowRunCounts,
  workflowHasResponseBlock: workflowsUtilsMockFns.mockWorkflowHasResponseBlock,
  createHttpResponseFromBlock: workflowsUtilsMockFns.mockCreateHttpResponseFromBlock,
  validateWorkflowPermissions: workflowsUtilsMockFns.mockValidateWorkflowPermissions,
  authorizeWorkflowByWorkspacePermission:
    workflowsUtilsMockFns.mockAuthorizeWorkflowByWorkspacePermission,
  createWorkflowRecord: workflowsUtilsMockFns.mockCreateWorkflowRecord,
  updateWorkflowRecord: workflowsUtilsMockFns.mockUpdateWorkflowRecord,
  deleteWorkflowRecord: workflowsUtilsMockFns.mockDeleteWorkflowRecord,
  setWorkflowVariables: workflowsUtilsMockFns.mockSetWorkflowVariables,
  createFolderRecord: workflowsUtilsMockFns.mockCreateFolderRecord,
  updateFolderRecord: workflowsUtilsMockFns.mockUpdateFolderRecord,
  deleteFolderRecord: workflowsUtilsMockFns.mockDeleteFolderRecord,
  checkForCircularReference: workflowsUtilsMockFns.mockCheckForCircularReference,
  listFolders: workflowsUtilsMockFns.mockListFolders,
}
