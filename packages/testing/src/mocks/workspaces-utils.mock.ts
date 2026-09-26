import { vi } from 'vitest'

const WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR =
  'Cannot remove the workspace billing account. Please reassign billing first.'

/**
 * Mirrors `WorkspaceBillingAccountRemovalError` from `@/lib/workspaces/utils`: same `name` and
 * message (`WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR`).
 */
export class MockWorkspaceBillingAccountRemovalError extends Error {
  constructor() {
    super(WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR)
    this.name = 'WorkspaceBillingAccountRemovalError'
  }
}

/**
 * Controllable mock functions for `@/lib/workspaces/utils`.
 *
 * Every loader and transaction helper is a bare `vi.fn()` (returns `undefined`) except the
 * account-deletion reassignments, which resolve an empty result
 * (`{ reassigned: [], unresolved: [] }`) — nothing to reassign:
 * - `mockReassignBilledAccountForUser`
 * - `mockReassignOwnedWorkspacesForUser`
 *
 * @example
 * ```ts
 * import { workspacesUtilsMockFns } from '@sim/testing/mocks/workspaces-utils.mock'
 *
 * workspacesUtilsMockFns.mockGetWorkspaceBilledAccountUserId.mockResolvedValue('owner-1')
 * ```
 */
export const workspacesUtilsMockFns = {
  mockGetWorkspaceBillingSettings: vi.fn(),
  mockGetWorkspaceBilledAccountUserId: vi.fn(),
  mockGetWorkspaceOrganizationId: vi.fn(),
  mockGetOrgAdminWorkspaceRows: vi.fn(),
  mockListAccessibleWorkspaceRowsForUser: vi.fn(),
  mockListUserWorkspaces: vi.fn(),
  mockTransferWorkspaceOwnershipToBilledAccountForMemberRemovalTx: vi.fn(),
  mockReassignWorkflowOwnershipForWorkspaceMemberRemovalTx: vi.fn(),
  mockReassignBilledAccountForUser: vi.fn(
    async (
      _departingUserId: string,
      _executor?: unknown
    ): Promise<{ reassigned: unknown[]; unresolved: string[] }> => ({
      reassigned: [],
      unresolved: [],
    })
  ),
  mockReassignOwnedWorkspacesForUser: vi.fn(
    async (
      _departingUserId: string,
      _executor?: unknown
    ): Promise<{ reassigned: unknown[]; unresolved: string[] }> => ({
      reassigned: [],
      unresolved: [],
    })
  ),
}

/**
 * Static mock module for `@/lib/workspaces/utils`. `WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR`
 * carries the real value; `WorkspaceBillingAccountRemovalError` is
 * {@link MockWorkspaceBillingAccountRemovalError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
 * ```
 */
export const workspacesUtilsMock = {
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR,
  WorkspaceBillingAccountRemovalError: MockWorkspaceBillingAccountRemovalError,
  getWorkspaceBillingSettings: workspacesUtilsMockFns.mockGetWorkspaceBillingSettings,
  getWorkspaceBilledAccountUserId: workspacesUtilsMockFns.mockGetWorkspaceBilledAccountUserId,
  getWorkspaceOrganizationId: workspacesUtilsMockFns.mockGetWorkspaceOrganizationId,
  getOrgAdminWorkspaceRows: workspacesUtilsMockFns.mockGetOrgAdminWorkspaceRows,
  listAccessibleWorkspaceRowsForUser: workspacesUtilsMockFns.mockListAccessibleWorkspaceRowsForUser,
  listUserWorkspaces: workspacesUtilsMockFns.mockListUserWorkspaces,
  transferWorkspaceOwnershipToBilledAccountForMemberRemovalTx:
    workspacesUtilsMockFns.mockTransferWorkspaceOwnershipToBilledAccountForMemberRemovalTx,
  reassignWorkflowOwnershipForWorkspaceMemberRemovalTx:
    workspacesUtilsMockFns.mockReassignWorkflowOwnershipForWorkspaceMemberRemovalTx,
  reassignBilledAccountForUser: workspacesUtilsMockFns.mockReassignBilledAccountForUser,
  reassignOwnedWorkspacesForUser: workspacesUtilsMockFns.mockReassignOwnedWorkspacesForUser,
}
