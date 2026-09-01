/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockInvitationsNotAllowedError,
  mockGetInvitationById,
  mockIsOrganizationOwnerOrAdmin,
  mockHasWorkspaceAdminAccess,
  mockGetWorkspaceWithOwner,
  mockGetWorkspaceInvitePolicy,
  mockValidateInvitationsAllowed,
  mockSendInvitationEmail,
  mockPrepareInvitationResend,
  mockPersistInvitationResend,
  mockGetOrganizationSubscription,
} = vi.hoisted(() => ({
  MockInvitationsNotAllowedError: class extends Error {
    constructor() {
      super('Invitations are not allowed based on your permission group settings')
      this.name = 'InvitationsNotAllowedError'
    }
  },
  mockGetInvitationById: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockPrepareInvitationResend: vi.fn(),
  mockPersistInvitationResend: vi.fn(),
  mockGetOrganizationSubscription: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { INVITATION_RESENT: 'invitation.resent', ORG_INVITATION_RESENT: 'org.resent' },
  AuditResourceType: { WORKSPACE: 'workspace', ORGANIZATION: 'organization' },
  recordAudit: vi.fn(),
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  InvitationsNotAllowedError: MockInvitationsNotAllowedError,
  validateInvitationsAllowed: mockValidateInvitationsAllowed,
}))

vi.mock('@/lib/invitations/core', () => ({ getInvitationById: mockGetInvitationById }))
vi.mock('@/lib/invitations/send', () => ({
  sendInvitationEmail: mockSendInvitationEmail,
  prepareInvitationResend: mockPrepareInvitationResend,
  persistInvitationResend: mockPersistInvitationResend,
}))
vi.mock('@/lib/billing/core/organization', () => ({
  isOrganizationOwnerOrAdmin: mockIsOrganizationOwnerOrAdmin,
}))
vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: mockGetOrganizationSubscription,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: mockHasWorkspaceAdminAccess,
  getWorkspaceWithOwner: mockGetWorkspaceWithOwner,
}))
vi.mock('@/lib/workspaces/policy', () => ({
  getWorkspaceInvitePolicy: mockGetWorkspaceInvitePolicy,
}))

import { POST } from '@/app/api/invitations/[id]/resend/route'

const mockGetSession = authMockFns.mockGetSession

function callResend() {
  return POST(
    createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/invitations/11111111-1111-4111-8111-111111111111/resend'
    ),
    { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
  )
}

const workspaceInvitation = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'pending',
  kind: 'workspace',
  email: 'invitee@example.com',
  role: 'member',
  token: 'token-1',
  organizationId: 'organization-1',
  membershipIntent: 'member',
  grants: [{ workspaceId: 'workspace-1', permission: 'read' }],
}

/**
 * A resend re-delivers a working link and pushes the expiry forward, so it is a
 * send: without the gate an organization that has withheld invitations still
 * admits every pending invitee, indefinitely.
 */
describe('POST /api/invitations/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'admin@example.com' } })
    mockGetInvitationById.mockResolvedValue(workspaceInvitation)
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-1',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValue({ allowed: true })
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockPrepareInvitationResend.mockResolvedValue({
      tokenForEmail: 'token-2',
      nextToken: 'token-2',
      nextExpiresAt: new Date('2026-09-30T00:00:00.000Z'),
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockPersistInvitationResend.mockResolvedValue(undefined)
  })

  it('resends when no group withholds invitations', async () => {
    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith('user-1', {
      workspaceId: 'workspace-1',
    })
    expect(mockSendInvitationEmail).toHaveBeenCalled()
  })

  it('refuses the resend when the group withholds invitations', async () => {
    mockValidateInvitationsAllowed.mockRejectedValue(new MockInvitationsNotAllowedError())

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockPersistInvitationResend).not.toHaveBeenCalled()
  })

  /**
   * The refusal names an organization setting, so it must never be reached by
   * someone with no admin standing to hear it.
   */
  it('checks admin standing before the permission group', async () => {
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    mockHasWorkspaceAdminAccess.mockResolvedValue(false)

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(mockValidateInvitationsAllowed).not.toHaveBeenCalled()
  })

  it('resolves the organization default group for an invitation with no grants', async () => {
    mockGetInvitationById.mockResolvedValue({
      ...workspaceInvitation,
      kind: 'organization',
      grants: [],
    })
    mockGetOrganizationSubscription.mockResolvedValue({ status: 'active', plan: 'team' })

    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith('user-1', {
      organizationId: 'organization-1',
    })
  })
})
