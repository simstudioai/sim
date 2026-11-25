import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/subscription`.
 *
 * Every async lookup is a bare `vi.fn()` (resolves `undefined`); set the plan or
 * entitlement a test needs per case. `isSubscriptionBackedEntitlement` defaults to `false`
 * (the real value reads env flags).
 *
 * @example
 * ```ts
 * import { billingSubscriptionMockFns } from '@sim/testing/mocks/billing-subscription.mock'
 *
 * billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan.mockResolvedValue(true)
 * billingSubscriptionMockFns.mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'team' })
 * ```
 */
export const billingSubscriptionMockFns = {
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
  mockWriteBillingInterval: vi.fn(),
  mockSyncSubscriptionPlan: vi.fn(),
  mockGetOrganizationSubscriptionUsable: vi.fn(),
  mockHasPaidSubscription: vi.fn(),
  mockGetOrganizationCoverageForMember: vi.fn(),
  mockGetOrganizationIdForSubscriptionReference: vi.fn(),
  mockIsProPlan: vi.fn(),
  mockIsTeamPlan: vi.fn(),
  mockIsEnterprisePlan: vi.fn(),
  mockIsEnterpriseOrgAdminOrOwner: vi.fn(),
  mockIsSubscriptionBackedEntitlement: vi.fn(() => false),
  mockResolveOrganizationPlan: vi.fn(),
  mockIsOrganizationOnEnterprisePlan: vi.fn(),
  mockIsOrganizationGovernanceActive: vi.fn(),
  mockIsOrganizationFeatureEntitled: vi.fn(),
  mockHasSSOAccess: vi.fn(),
  mockIsWorkspaceOnEnterprisePlan: vi.fn(),
  mockHasWorkspaceInboxAccess: vi.fn(),
  mockHasWorkspaceInboxGraceAccess: vi.fn(),
  mockHasWorkspaceLiveSyncAccess: vi.fn(),
  mockHasWorkspaceSandboxAccess: vi.fn(),
  mockHasWorkspaceSandboxRetentionAccess: vi.fn(),
  mockSendPlanWelcomeEmail: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/subscription`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
 * ```
 */
export const billingSubscriptionMock = {
  getHighestPriorityPersonalSubscription:
    billingSubscriptionMockFns.mockGetHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription: billingSubscriptionMockFns.mockGetHighestPrioritySubscription,
  writeBillingInterval: billingSubscriptionMockFns.mockWriteBillingInterval,
  syncSubscriptionPlan: billingSubscriptionMockFns.mockSyncSubscriptionPlan,
  getOrganizationSubscriptionUsable:
    billingSubscriptionMockFns.mockGetOrganizationSubscriptionUsable,
  hasPaidSubscription: billingSubscriptionMockFns.mockHasPaidSubscription,
  getOrganizationCoverageForMember: billingSubscriptionMockFns.mockGetOrganizationCoverageForMember,
  getOrganizationIdForSubscriptionReference:
    billingSubscriptionMockFns.mockGetOrganizationIdForSubscriptionReference,
  isProPlan: billingSubscriptionMockFns.mockIsProPlan,
  isTeamPlan: billingSubscriptionMockFns.mockIsTeamPlan,
  isEnterprisePlan: billingSubscriptionMockFns.mockIsEnterprisePlan,
  isEnterpriseOrgAdminOrOwner: billingSubscriptionMockFns.mockIsEnterpriseOrgAdminOrOwner,
  isSubscriptionBackedEntitlement: billingSubscriptionMockFns.mockIsSubscriptionBackedEntitlement,
  resolveOrganizationPlan: billingSubscriptionMockFns.mockResolveOrganizationPlan,
  isOrganizationOnEnterprisePlan: billingSubscriptionMockFns.mockIsOrganizationOnEnterprisePlan,
  isOrganizationGovernanceActive: billingSubscriptionMockFns.mockIsOrganizationGovernanceActive,
  isOrganizationFeatureEntitled: billingSubscriptionMockFns.mockIsOrganizationFeatureEntitled,
  hasSSOAccess: billingSubscriptionMockFns.mockHasSSOAccess,
  isWorkspaceOnEnterprisePlan: billingSubscriptionMockFns.mockIsWorkspaceOnEnterprisePlan,
  hasWorkspaceInboxAccess: billingSubscriptionMockFns.mockHasWorkspaceInboxAccess,
  hasWorkspaceInboxGraceAccess: billingSubscriptionMockFns.mockHasWorkspaceInboxGraceAccess,
  hasWorkspaceLiveSyncAccess: billingSubscriptionMockFns.mockHasWorkspaceLiveSyncAccess,
  hasWorkspaceSandboxAccess: billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess,
  hasWorkspaceSandboxRetentionAccess:
    billingSubscriptionMockFns.mockHasWorkspaceSandboxRetentionAccess,
  sendPlanWelcomeEmail: billingSubscriptionMockFns.mockSendPlanWelcomeEmail,
}
