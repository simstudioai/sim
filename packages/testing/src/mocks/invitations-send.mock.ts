import { vi } from 'vitest'

interface MockInvitationStanding {
  membershipIntent: string
  role: string
}

function describeInvitationStanding({ membershipIntent, role }: MockInvitationStanding): string {
  if (membershipIntent === 'external') return 'an external collaborator'
  return role === 'owner' || role === 'admin' ? 'an organization admin' : 'an organization member'
}

/**
 * Mirrors `ConflictingPendingInvitationError` from `@/lib/invitations/send`: same constructor
 * params, `name`, and message. It is a plain `Error` subclass like the real one.
 */
export class MockConflictingPendingInvitationError extends Error {
  constructor(params: {
    email: string
    existing: MockInvitationStanding
    requested: MockInvitationStanding
  }) {
    super(
      `${params.email} already has a pending invitation as ${describeInvitationStanding(
        params.existing
      )}. Cancel it before inviting them as ${describeInvitationStanding(params.requested)}.`
    )
    this.name = 'ConflictingPendingInvitationError'
  }
}

/**
 * Mirrors `GrantlessInvitationError` from `@/lib/invitations/send`: same `name` and message.
 */
export class MockGrantlessInvitationError extends Error {
  constructor() {
    super('Workspace and external invitations must include at least one workspace.')
    this.name = 'GrantlessInvitationError'
  }
}

/**
 * Controllable mock functions for `@/lib/invitations/send`. Every function is a bare `vi.fn()`
 * (returns `undefined`).
 *
 * @example
 * ```ts
 * import { invitationsSendMockFns } from '@sim/testing/mocks/invitations-send.mock'
 *
 * invitationsSendMockFns.mockSendInvitationEmail.mockResolvedValue({ success: true })
 * ```
 */
export const invitationsSendMockFns = {
  mockFindPendingOrganizationInvitation: vi.fn(),
  mockCreatePendingInvitation: vi.fn(),
  mockRevertPendingInvitationGrants: vi.fn(),
  mockFindPendingGrantWorkspaceIds: vi.fn(),
  mockCancelPendingInvitation: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockSendWorkspaceAddedEmail: vi.fn(),
  mockPrepareInvitationResend: vi.fn(),
  mockRevertInvitationResend: vi.fn(),
}

/**
 * Static mock module for `@/lib/invitations/send`. `PENDING_INVITATION_UNIQUE_INDEX` carries the
 * real value; the error classes are {@link MockConflictingPendingInvitationError} and
 * {@link MockGrantlessInvitationError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/invitations/send', () => invitationsSendMock)
 * ```
 */
export const invitationsSendMock = {
  PENDING_INVITATION_UNIQUE_INDEX: 'invitation_pending_email_org_unique',
  ConflictingPendingInvitationError: MockConflictingPendingInvitationError,
  GrantlessInvitationError: MockGrantlessInvitationError,
  findPendingOrganizationInvitation: invitationsSendMockFns.mockFindPendingOrganizationInvitation,
  createPendingInvitation: invitationsSendMockFns.mockCreatePendingInvitation,
  revertPendingInvitationGrants: invitationsSendMockFns.mockRevertPendingInvitationGrants,
  findPendingGrantWorkspaceIds: invitationsSendMockFns.mockFindPendingGrantWorkspaceIds,
  cancelPendingInvitation: invitationsSendMockFns.mockCancelPendingInvitation,
  sendInvitationEmail: invitationsSendMockFns.mockSendInvitationEmail,
  sendWorkspaceAddedEmail: invitationsSendMockFns.mockSendWorkspaceAddedEmail,
  prepareInvitationResend: invitationsSendMockFns.mockPrepareInvitationResend,
  revertInvitationResend: invitationsSendMockFns.mockRevertInvitationResend,
}
