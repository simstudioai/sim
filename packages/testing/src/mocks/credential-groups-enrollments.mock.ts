import { vi } from 'vitest'

/**
 * Stand-in for `CredentialGroupEnrollmentError` from `@/lib/credential-groups/enrollments`: same
 * `name`, message and `status` constructor argument.
 */
export class MockCredentialGroupEnrollmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502
  ) {
    super(message)
    this.name = 'CredentialGroupEnrollmentError'
  }
}

/**
 * Controllable mock functions for `@/lib/credential-groups/enrollments`.
 *
 * Every function is a bare `vi.fn()` except `mockLockCredentialGroupEnrollmentLifecycle`, which
 * resolves `undefined` (an uncontended advisory lock).
 *
 * @example
 * ```ts
 * import { credentialGroupsEnrollmentsMockFns } from '@sim/testing/mocks/credential-groups-enrollments.mock'
 *
 * expect(credentialGroupsEnrollmentsMockFns.mockLockCredentialGroupEnrollmentLifecycle)
 *   .toHaveBeenCalledWith(expect.anything(), 'enrollment-1')
 * ```
 */
export const credentialGroupsEnrollmentsMockFns = {
  mockLockCredentialGroupEnrollmentLifecycle: vi.fn(
    async (_executor: unknown, _enrollmentId: string): Promise<void> => {}
  ),
  mockAuthenticatePublicCredentialGroupEnrollment: vi.fn(),
  mockBindCredentialGroupEnrollmentUser: vi.fn(),
  mockListCredentialGroupEnrollments: vi.fn(),
  mockInviteCredentialGroupEnrollments: vi.fn(),
  mockLoadCredentialGroupInviterIdentity: vi.fn(),
  mockInviteCredentialGroupEnrollment: vi.fn(),
  mockCreateCredentialGroupSelfEnrollmentLink: vi.fn(),
  mockCreateCredentialGroupInvitationLink: vi.fn(),
  mockResendCredentialGroupEnrollment: vi.fn(),
  mockDeleteCredentialGroupEnrollment: vi.fn(),
  mockRevokeCredentialGroupEnrollment: vi.fn(),
  mockGetPublicCredentialGroupEnrollment: vi.fn(),
  mockGetAuthorizedPublicCredentialGroupEnrollment: vi.fn(),
  mockCompleteCredentialGroupEnrollment: vi.fn(),
  mockCompleteAuthorizedCredentialGroupEnrollment: vi.fn(),
  mockGetCredentialGroupOAuthContext: vi.fn(),
  mockGetAuthorizedCredentialGroupOAuthContext: vi.fn(),
  mockGetCredentialGroupOAuthContextForEnrollment: vi.fn(),
  mockGetAuthorizedCredentialGroupMcpOAuthContext: vi.fn(),
  mockGetCredentialGroupMcpOAuthContextForEnrollment: vi.fn(),
}

const fns = credentialGroupsEnrollmentsMockFns

/**
 * Static mock module for `@/lib/credential-groups/enrollments`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)
 * ```
 */
export const credentialGroupsEnrollmentsMock = {
  CredentialGroupEnrollmentError: MockCredentialGroupEnrollmentError,
  lockCredentialGroupEnrollmentLifecycle: fns.mockLockCredentialGroupEnrollmentLifecycle,
  authenticatePublicCredentialGroupEnrollment: fns.mockAuthenticatePublicCredentialGroupEnrollment,
  bindCredentialGroupEnrollmentUser: fns.mockBindCredentialGroupEnrollmentUser,
  listCredentialGroupEnrollments: fns.mockListCredentialGroupEnrollments,
  inviteCredentialGroupEnrollments: fns.mockInviteCredentialGroupEnrollments,
  loadCredentialGroupInviterIdentity: fns.mockLoadCredentialGroupInviterIdentity,
  inviteCredentialGroupEnrollment: fns.mockInviteCredentialGroupEnrollment,
  createCredentialGroupSelfEnrollmentLink: fns.mockCreateCredentialGroupSelfEnrollmentLink,
  createCredentialGroupInvitationLink: fns.mockCreateCredentialGroupInvitationLink,
  resendCredentialGroupEnrollment: fns.mockResendCredentialGroupEnrollment,
  deleteCredentialGroupEnrollment: fns.mockDeleteCredentialGroupEnrollment,
  revokeCredentialGroupEnrollment: fns.mockRevokeCredentialGroupEnrollment,
  getPublicCredentialGroupEnrollment: fns.mockGetPublicCredentialGroupEnrollment,
  getAuthorizedPublicCredentialGroupEnrollment:
    fns.mockGetAuthorizedPublicCredentialGroupEnrollment,
  completeCredentialGroupEnrollment: fns.mockCompleteCredentialGroupEnrollment,
  completeAuthorizedCredentialGroupEnrollment: fns.mockCompleteAuthorizedCredentialGroupEnrollment,
  getCredentialGroupOAuthContext: fns.mockGetCredentialGroupOAuthContext,
  getAuthorizedCredentialGroupOAuthContext: fns.mockGetAuthorizedCredentialGroupOAuthContext,
  getCredentialGroupOAuthContextForEnrollment: fns.mockGetCredentialGroupOAuthContextForEnrollment,
  getAuthorizedCredentialGroupMcpOAuthContext: fns.mockGetAuthorizedCredentialGroupMcpOAuthContext,
  getCredentialGroupMcpOAuthContextForEnrollment:
    fns.mockGetCredentialGroupMcpOAuthContextForEnrollment,
}
