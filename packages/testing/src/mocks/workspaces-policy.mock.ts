import { vi } from 'vitest'

const WORKSPACE_MODE = {
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
  GRANDFATHERED_SHARED: 'grandfathered_shared',
} as const

const UPGRADE_TO_INVITE_REASON = 'Upgrade to invite more members'
const CONTACT_OWNER_TO_UPGRADE_REASON = 'Contact workspace owner to upgrade'

interface MockWorkspaceInvitePolicy {
  allowed: boolean
  reason: string | null
  upgradeRequired: boolean
}

/**
 * Mirrors `WorkspaceOwnerMissingError` from `@/lib/workspaces/policy`: same `(userId)`
 * constructor, `name`, and message.
 */
export class MockWorkspaceOwnerMissingError extends Error {
  constructor(userId: string) {
    super(`User ${userId} no longer exists`)
    this.name = 'WorkspaceOwnerMissingError'
  }
}

/**
 * Mirrors `WorkspaceCreationContextChangedError` from `@/lib/workspaces/policy`: same optional
 * message (with the real default) and `name`.
 */
export class MockWorkspaceCreationContextChangedError extends Error {
  constructor(message = 'Workspace creation context changed before the workspace was inserted') {
    super(message)
    this.name = 'WorkspaceCreationContextChangedError'
  }
}

/**
 * Mirrors `WorkspaceCreationCapabilityWithheldError` from `@/lib/workspaces/policy`: a subclass of
 * {@link MockWorkspaceCreationContextChangedError} (as the real one subclasses the real parent)
 * with the real capability-refusal message and `name`.
 */
export class MockWorkspaceCreationCapabilityWithheldError extends MockWorkspaceCreationContextChangedError {
  constructor() {
    super("Creating a workspace is not available under your organization's permission group")
    this.name = 'WorkspaceCreationCapabilityWithheldError'
  }
}

/**
 * Controllable mock functions for `@/lib/workspaces/policy`.
 *
 * Loaders, lock helpers, and the billing-flag-dependent evaluators
 * (`canCreateOrganizationWorkspace`, `evaluateWorkspaceInvitePolicy`) are bare `vi.fn()`s
 * (return `undefined`). The pure helpers port the real logic:
 * - `mockIsOrganizationWorkspace(ws)` is true when `workspaceMode === 'organization'` and
 *   `organizationId` is a non-empty string.
 * - `mockResolveInviteFlags(policy, callerIsBilledUser)` derives the real caller-facing flags.
 *
 * @example
 * ```ts
 * import { workspacesPolicyMockFns } from '@sim/testing/mocks/workspaces-policy.mock'
 *
 * workspacesPolicyMockFns.mockGetWorkspaceInvitePolicy.mockResolvedValue({
 *   allowed: true, reason: null, requiresSeat: false, organizationId: 'org-1', upgradeRequired: false,
 * })
 * ```
 */
export const workspacesPolicyMockFns = {
  mockCanCreateOrganizationWorkspace: vi.fn(),
  mockResolveInviteFlags: vi.fn(
    (invitePolicy: MockWorkspaceInvitePolicy, callerIsBilledUser: boolean) => ({
      inviteMembersEnabled: invitePolicy.allowed,
      inviteDisabledReason: invitePolicy.allowed
        ? null
        : callerIsBilledUser
          ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
          : CONTACT_OWNER_TO_UPGRADE_REASON,
      inviteUpgradeRequired: invitePolicy.upgradeRequired && callerIsBilledUser,
    })
  ),
  mockResolveGoverningPermissionGroupOrganization: vi.fn(),
  mockLockWorkspaceCreationContext: vi.fn(),
  mockIsOrganizationWorkspace: vi.fn(
    (workspaceState: { workspaceMode?: string | null; organizationId?: string | null }): boolean =>
      workspaceState.workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
      typeof workspaceState.organizationId === 'string' &&
      workspaceState.organizationId.length > 0
  ),
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockEvaluateWorkspaceInvitePolicy: vi.fn(),
  mockGetInvitePlanCategoryForOrganization: vi.fn(),
  mockGetInvitePlanCategoryForUser: vi.fn(),
  mockGetWorkspaceCreationPolicy: vi.fn(),
  mockGetOrganizationOwnerId: vi.fn(),
}

/**
 * Static mock module for `@/lib/workspaces/policy`. `WORKSPACE_MODE`, `UPGRADE_TO_INVITE_REASON`
 * and `CONTACT_OWNER_TO_UPGRADE_REASON` carry the real values; the error classes are
 * {@link MockWorkspaceOwnerMissingError}, {@link MockWorkspaceCreationContextChangedError} and
 * {@link MockWorkspaceCreationCapabilityWithheldError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)
 * ```
 */
export const workspacesPolicyMock = {
  WORKSPACE_MODE,
  UPGRADE_TO_INVITE_REASON,
  CONTACT_OWNER_TO_UPGRADE_REASON,
  WorkspaceOwnerMissingError: MockWorkspaceOwnerMissingError,
  WorkspaceCreationContextChangedError: MockWorkspaceCreationContextChangedError,
  WorkspaceCreationCapabilityWithheldError: MockWorkspaceCreationCapabilityWithheldError,
  canCreateOrganizationWorkspace: workspacesPolicyMockFns.mockCanCreateOrganizationWorkspace,
  resolveInviteFlags: workspacesPolicyMockFns.mockResolveInviteFlags,
  resolveGoverningPermissionGroupOrganization:
    workspacesPolicyMockFns.mockResolveGoverningPermissionGroupOrganization,
  lockWorkspaceCreationContext: workspacesPolicyMockFns.mockLockWorkspaceCreationContext,
  isOrganizationWorkspace: workspacesPolicyMockFns.mockIsOrganizationWorkspace,
  getWorkspaceInvitePolicy: workspacesPolicyMockFns.mockGetWorkspaceInvitePolicy,
  evaluateWorkspaceInvitePolicy: workspacesPolicyMockFns.mockEvaluateWorkspaceInvitePolicy,
  getInvitePlanCategoryForOrganization:
    workspacesPolicyMockFns.mockGetInvitePlanCategoryForOrganization,
  getInvitePlanCategoryForUser: workspacesPolicyMockFns.mockGetInvitePlanCategoryForUser,
  getWorkspaceCreationPolicy: workspacesPolicyMockFns.mockGetWorkspaceCreationPolicy,
  getOrganizationOwnerId: workspacesPolicyMockFns.mockGetOrganizationOwnerId,
}
