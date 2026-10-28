import { vi } from 'vitest'

const INVITATION_EXPIRY_DAYS = 7

/**
 * Controllable mock functions for `@/lib/invitations/core`.
 *
 * Every loader/mutation is a bare `vi.fn()` (returns `undefined`) except the pure helpers,
 * which port the real logic:
 * - `mockComputeInvitationExpiry(daysFromNow = 7)` returns `now + daysFromNow` days.
 * - `mockIsInvitationExpired({ expiresAt })` returns `new Date() > new Date(expiresAt)`.
 *
 * @example
 * ```ts
 * import { invitationsCoreMockFns } from '@sim/testing/mocks/invitations-core.mock'
 *
 * invitationsCoreMockFns.mockGetInvitationById.mockResolvedValue({ id: 'inv-1', status: 'pending' })
 * ```
 */
export const invitationsCoreMockFns = {
  mockComputeInvitationExpiry: vi.fn(
    (daysFromNow: number = INVITATION_EXPIRY_DAYS): Date =>
      new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000)
  ),
  mockGetInvitationById: vi.fn(),
  mockLockInvitationForMutation: vi.fn(),
  mockRequireInvitationResendAuthority: vi.fn(),
  mockIsInvitationExpired: vi.fn(
    (inv: { expiresAt: Date | string | number }): boolean => new Date() > new Date(inv.expiresAt)
  ),
  mockResolveInvitationAdmissionOrganizationId: vi.fn(),
  mockGetInvitationJoinPreview: vi.fn(),
  mockExpireStalePendingInvitationsForOrganization: vi.fn(),
  mockAcceptInvitation: vi.fn(),
  mockUpdateInvitation: vi.fn(),
  mockRejectInvitation: vi.fn(),
  mockRevokeInvitationAsAdmin: vi.fn(),
  mockRevokeInvitationWorkspaceGrantTx: vi.fn(),
  mockListPendingInvitationsForEmail: vi.fn(),
  mockListInvitationsForWorkspaces: vi.fn(),
}

/**
 * Static mock module for `@/lib/invitations/core`, including the re-exported
 * `INVITATION_EXPIRY_DAYS` (real value `7`).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
 * ```
 */
export const invitationsCoreMock = {
  INVITATION_EXPIRY_DAYS,
  computeInvitationExpiry: invitationsCoreMockFns.mockComputeInvitationExpiry,
  getInvitationById: invitationsCoreMockFns.mockGetInvitationById,
  lockInvitationForMutation: invitationsCoreMockFns.mockLockInvitationForMutation,
  requireInvitationResendAuthority: invitationsCoreMockFns.mockRequireInvitationResendAuthority,
  isInvitationExpired: invitationsCoreMockFns.mockIsInvitationExpired,
  resolveInvitationAdmissionOrganizationId:
    invitationsCoreMockFns.mockResolveInvitationAdmissionOrganizationId,
  getInvitationJoinPreview: invitationsCoreMockFns.mockGetInvitationJoinPreview,
  expireStalePendingInvitationsForOrganization:
    invitationsCoreMockFns.mockExpireStalePendingInvitationsForOrganization,
  acceptInvitation: invitationsCoreMockFns.mockAcceptInvitation,
  updateInvitation: invitationsCoreMockFns.mockUpdateInvitation,
  rejectInvitation: invitationsCoreMockFns.mockRejectInvitation,
  revokeInvitationAsAdmin: invitationsCoreMockFns.mockRevokeInvitationAsAdmin,
  revokeInvitationWorkspaceGrantTx: invitationsCoreMockFns.mockRevokeInvitationWorkspaceGrantTx,
  listPendingInvitationsForEmail: invitationsCoreMockFns.mockListPendingInvitationsForEmail,
  listInvitationsForWorkspaces: invitationsCoreMockFns.mockListInvitationsForWorkspaces,
}
