import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/organizations/membership`.
 *
 * Every function is a bare `vi.fn()` (resolves `undefined`). The lock acquirers therefore behave
 * as instant no-op locks, which is what nearly every consumer wants; set return values for the
 * lookups (`getUserOrganization`, `isSoleOwnerOfPaidOrganization`, …) per test.
 *
 * @example
 * ```ts
 * import { organizationMembershipMockFns } from '@sim/testing/mocks/organization-membership.mock'
 *
 * organizationMembershipMockFns.mockGetUserOrganization.mockResolvedValue({
 *   organizationId: 'org-1', role: 'owner', memberId: 'member-1',
 * })
 * ```
 */
export const organizationMembershipMockFns = {
  mockAcquireUserBillingIdentityLock: vi.fn(),
  mockAcquireOrganizationMutationLock: vi.fn(),
  mockAcquireOrgMembershipLock: vi.fn(),
  mockAcquireOrganizationUserMutationLocks: vi.fn(),
  mockGetOrgMemberIds: vi.fn(),
  mockBlockOrgMembers: vi.fn(),
  mockUnblockOrgMembers: vi.fn(),
  mockRestoreUserProSubscription: vi.fn(),
  mockPauseProSubscriptionForOrgCoverage: vi.fn(),
  mockEnsureUserInOrganizationTx: vi.fn(),
  mockReapplyPaidOrgJoinBillingForExistingMemberTx: vi.fn(),
  mockWithInvitationSafeOrganizationAccessMutation: vi.fn(),
  mockGetOrganizationTransferCredentialDependencies: vi.fn(),
  mockTransferUserBetweenOrganizations: vi.fn(),
  mockRemoveUserFromOrganization: vi.fn(),
  mockRemoveExternalUserFromOrganizationWorkspaces: vi.fn(),
  mockTransferOrganizationOwnership: vi.fn(),
  mockIsSoleOwnerOfPaidOrganization: vi.fn(),
  mockGetUserOrganization: vi.fn(),
  mockEnsureUserInOrganization: vi.fn(),
  mockAddUserToOrganization: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/organizations/membership`, including its constants
 * (`MEMBER_BILLING_RECONCILIATION_EVENT_TYPE` and the re-exported
 * `WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR`) with their real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
 * ```
 */
export const organizationMembershipMock = {
  MEMBER_BILLING_RECONCILIATION_EVENT_TYPE: 'billing.reconcile-member-after-org-leave',
  WORKSPACE_BILLING_ACCOUNT_REMOVAL_ERROR:
    'Cannot remove the workspace billing account. Please reassign billing first.',
  acquireUserBillingIdentityLock: organizationMembershipMockFns.mockAcquireUserBillingIdentityLock,
  acquireOrganizationMutationLock:
    organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
  acquireOrgMembershipLock: organizationMembershipMockFns.mockAcquireOrgMembershipLock,
  acquireOrganizationUserMutationLocks:
    organizationMembershipMockFns.mockAcquireOrganizationUserMutationLocks,
  getOrgMemberIds: organizationMembershipMockFns.mockGetOrgMemberIds,
  blockOrgMembers: organizationMembershipMockFns.mockBlockOrgMembers,
  unblockOrgMembers: organizationMembershipMockFns.mockUnblockOrgMembers,
  restoreUserProSubscription: organizationMembershipMockFns.mockRestoreUserProSubscription,
  pauseProSubscriptionForOrgCoverage:
    organizationMembershipMockFns.mockPauseProSubscriptionForOrgCoverage,
  ensureUserInOrganizationTx: organizationMembershipMockFns.mockEnsureUserInOrganizationTx,
  reapplyPaidOrgJoinBillingForExistingMemberTx:
    organizationMembershipMockFns.mockReapplyPaidOrgJoinBillingForExistingMemberTx,
  withInvitationSafeOrganizationAccessMutation:
    organizationMembershipMockFns.mockWithInvitationSafeOrganizationAccessMutation,
  getOrganizationTransferCredentialDependencies:
    organizationMembershipMockFns.mockGetOrganizationTransferCredentialDependencies,
  transferUserBetweenOrganizations:
    organizationMembershipMockFns.mockTransferUserBetweenOrganizations,
  removeUserFromOrganization: organizationMembershipMockFns.mockRemoveUserFromOrganization,
  removeExternalUserFromOrganizationWorkspaces:
    organizationMembershipMockFns.mockRemoveExternalUserFromOrganizationWorkspaces,
  transferOrganizationOwnership: organizationMembershipMockFns.mockTransferOrganizationOwnership,
  isSoleOwnerOfPaidOrganization: organizationMembershipMockFns.mockIsSoleOwnerOfPaidOrganization,
  getUserOrganization: organizationMembershipMockFns.mockGetUserOrganization,
  ensureUserInOrganization: organizationMembershipMockFns.mockEnsureUserInOrganization,
  addUserToOrganization: organizationMembershipMockFns.mockAddUserToOrganization,
}
