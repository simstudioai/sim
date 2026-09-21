/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { authMockFns, createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockInvitationsNotAllowedError,
  mockGetInvitationById,
  mockResolveInvitationAdmissionOrganizationId,
  mockIsOrganizationOwnerOrAdmin,
  mockHasWorkspaceAdminAccess,
  mockGetWorkspaceWithOwner,
  mockGetWorkspaceInvitePolicy,
  mockValidateInvitationsAllowed,
  mockSendInvitationEmail,
  mockPrepareInvitationResend,
  mockRevertInvitationResend,
  mockGetOrganizationSubscription,
} = vi.hoisted(() => ({
  MockInvitationsNotAllowedError: class extends Error {
    constructor() {
      super('Invitations are not allowed based on your permission group settings')
      this.name = 'InvitationsNotAllowedError'
    }
  },
  mockGetInvitationById: vi.fn(),
  mockResolveInvitationAdmissionOrganizationId: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
  mockHasWorkspaceAdminAccess: vi.fn(),
  mockGetWorkspaceWithOwner: vi.fn(),
  mockGetWorkspaceInvitePolicy: vi.fn(),
  mockValidateInvitationsAllowed: vi.fn(),
  mockSendInvitationEmail: vi.fn(),
  mockPrepareInvitationResend: vi.fn(),
  mockRevertInvitationResend: vi.fn(),
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

vi.mock('@/lib/invitations/core', () => ({
  getInvitationById: mockGetInvitationById,
  resolveInvitationAdmissionOrganizationId: mockResolveInvitationAdmissionOrganizationId,
  requireInvitationResendAuthority: vi.fn(),
}))
vi.mock('@/lib/invitations/send', () => ({
  sendInvitationEmail: mockSendInvitationEmail,
  prepareInvitationResend: mockPrepareInvitationResend,
  revertInvitationResend: mockRevertInvitationResend,
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
  WORKSPACE_MODE: { ORGANIZATION: 'organization' },
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { lockInvitationResendPolicy } from '@/lib/invitations/resend-policy'
import type { PreparedInvitationResend } from '@/lib/invitations/send'
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
  expiresAt: new Date('2099-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  organizationId: 'organization-1',
  membershipIntent: 'internal',
  grants: [{ workspaceId: 'workspace-1', permission: 'read' }],
}

const preparedResend: PreparedInvitationResend = {
  invitationId: workspaceInvitation.id,
  organizationId: workspaceInvitation.organizationId,
  tokenForEmail: 'token-2',
  nextExpiresAt: new Date('2099-02-01'),
  mutationUpdatedAt: new Date('2026-02-01'),
  previousToken: workspaceInvitation.token,
  previousExpiresAt: workspaceInvitation.expiresAt,
}

/**
 * A resend re-delivers a working link and pushes the expiry forward, so it is a
 * send: without the gate an organization that has withheld invitations still
 * admits every pending invitee, indefinitely.
 */
describe('POST /api/invitations/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(member, [{ role: 'admin' }])
    queueTableRows(user, [{ name: 'Admin', email: 'admin@example.com' }])
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'admin@example.com' },
      session: { id: 'session-1' },
    })
    mockGetInvitationById.mockResolvedValue(workspaceInvitation)
    mockResolveInvitationAdmissionOrganizationId.mockResolvedValue('organization-1')
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
    mockHasWorkspaceAdminAccess.mockResolvedValue(true)
    mockGetWorkspaceWithOwner.mockResolvedValue({
      id: 'workspace-1',
      organizationId: 'organization-1',
      workspaceMode: 'organization',
      billedAccountUserId: 'owner',
      ownerId: 'owner',
    })
    mockGetWorkspaceInvitePolicy.mockResolvedValue({ allowed: true })
    mockValidateInvitationsAllowed.mockResolvedValue(undefined)
    mockPrepareInvitationResend.mockImplementation(async (params) => {
      await lockInvitationResendPolicy(
        db,
        await mockGetInvitationById(params.invitationId),
        params.actorUserId,
        params.expectedOrganizationId
      )
      return preparedResend
    })
    mockSendInvitationEmail.mockResolvedValue({ success: true })
    mockRevertInvitationResend.mockResolvedValue(true)
  })

  it('resends when no group withholds invitations', async () => {
    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        workspaceId: 'workspace-1',
      },
      db
    )
    expect(mockSendInvitationEmail).toHaveBeenCalled()
    expect(mockPrepareInvitationResend.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendInvitationEmail.mock.invocationCallOrder[0]
    )
  })

  /**
   * The refusal carries the shared capability contract — the same sentence and
   * `details.code` every other withheld capability answers with — so a client
   * can tell a permission group apart from a role failure without parsing prose.
   */
  it('refuses the resend with the shared capability refusal when the group withholds invitations', async () => {
    mockValidateInvitationsAllowed.mockRejectedValue(new MockInvitationsNotAllowedError())

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "Sending invitations is not available under your organization's permission group",
      details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' },
    })
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockRevertInvitationResend).not.toHaveBeenCalled()
  })

  /**
   * The refusal names an organization setting, so it must never be reached by
   * someone with no admin standing to hear it.
   */
  it('checks admin standing before the permission group', async () => {
    resetDbChainMock()
    queueTableRows(member, [{ role: 'member' }])
    mockIsOrganizationOwnerOrAdmin.mockResolvedValue(false)
    mockHasWorkspaceAdminAccess.mockResolvedValue(false)

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(mockValidateInvitationsAllowed).not.toHaveBeenCalled()
  })

  /**
   * An organization-kind invitation always admits the invitee to its stamped
   * organization, whichever workspaces it also grants — so the organization
   * scope is checked as well as, not instead of, the grants. Gating only the
   * grants would let an explicit workspace group that permits invitations carry
   * a member into an organization whose default group withholds them.
   */
  it('checks the organization scope as well as the grants for an organization invitation', async () => {
    mockGetInvitationById.mockResolvedValue({ ...workspaceInvitation, kind: 'organization' })

    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        organizationId: 'organization-1',
      },
      db
    )
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        workspaceId: 'workspace-1',
      },
      db
    )
  })

  it('refuses an organization invitation the organization default group withholds, even when its granted workspace allows', async () => {
    mockGetInvitationById.mockResolvedValue({ ...workspaceInvitation, kind: 'organization' })
    mockValidateInvitationsAllowed.mockImplementation(
      async (_userId: string, scope: { organizationId?: string }) => {
        if (scope.organizationId) throw new MockInvitationsNotAllowedError()
      }
    )

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockRevertInvitationResend).not.toHaveBeenCalled()
  })

  /**
   * The scope follows what acceptance would DO, not the invitation's kind. A
   * workspace-kind invitation whose granted workspace belongs to an organization
   * joins the invitee to that organization exactly as an organization-kind one
   * does, so keying the organization check on `kind === 'organization'` left
   * every organization-backed workspace invitation performing an ungated
   * organization admission.
   */
  it('checks the organization an organization-backed workspace invitation admits to', async () => {
    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockResolveInvitationAdmissionOrganizationId).toHaveBeenCalledWith(
      workspaceInvitation,
      db
    )
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        organizationId: 'organization-1',
      },
      db
    )
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        workspaceId: 'workspace-1',
      },
      db
    )
  })

  it('refuses a workspace invitation whose admitting organization withholds invitations', async () => {
    mockValidateInvitationsAllowed.mockImplementation(
      async (_userId: string, scope: { organizationId?: string }) => {
        if (scope.organizationId) throw new MockInvitationsNotAllowedError()
      }
    )

    const response = await callResend()

    expect(response.status).toBe(403)
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockRevertInvitationResend).not.toHaveBeenCalled()
  })

  /**
   * Nothing to gate at the organization scope when acceptance creates no member
   * row there — an external invitation, or a personal workspace's — so the
   * grants stay the whole scope rather than borrowing a stamped organization the
   * invitee will never join.
   */
  it('checks the grants alone when the invitation admits to no organization', async () => {
    mockResolveInvitationAdmissionOrganizationId.mockResolvedValue(null)

    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledTimes(1)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        workspaceId: 'workspace-1',
      },
      db
    )
  })

  it('resolves the organization default group for an invitation with no grants', async () => {
    mockGetInvitationById.mockResolvedValue({
      ...workspaceInvitation,
      kind: 'organization',
      grants: [],
    })
    mockResolveInvitationAdmissionOrganizationId.mockResolvedValue('organization-1')
    mockGetOrganizationSubscription.mockResolvedValue({ status: 'active', plan: 'team' })

    const response = await callResend()

    expect(response.status).toBe(200)
    expect(mockValidateInvitationsAllowed).toHaveBeenCalledWith(
      'user-1',
      {
        organizationId: 'organization-1',
      },
      db
    )
  })
  it.each(['pending', 'expired'])(
    'rejects an expired %s invitation consistently',
    async (status) => {
      mockGetInvitationById.mockResolvedValue({
        ...workspaceInvitation,
        status,
        expiresAt: new Date('2000-01-01'),
      })
      expect((await callResend()).status).toBe(400)
      expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    }
  )

  it('restores the previous token when delivery fails', async () => {
    mockSendInvitationEmail.mockResolvedValue({ success: false, error: 'Delivery unavailable' })
    expect((await callResend()).status).toBe(502)
    expect(mockRevertInvitationResend).toHaveBeenCalledWith(preparedResend)
  })

  it('does not deliver a token when a concurrent change prevents persistence', async () => {
    mockPrepareInvitationResend.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'Invitation changed')
    )
    expect((await callResend()).status).toBe(409)
    expect(mockSendInvitationEmail).not.toHaveBeenCalled()
    expect(mockRevertInvitationResend).not.toHaveBeenCalled()
  })

  it('compensates when delivery throws', async () => {
    mockSendInvitationEmail.mockRejectedValueOnce(new Error('Mail transport unavailable'))
    expect((await callResend()).status).toBe(502)
    expect(mockRevertInvitationResend).toHaveBeenCalledOnce()
  })

  it('reports a conflict when failed delivery cannot be compensated over newer state', async () => {
    mockSendInvitationEmail.mockResolvedValueOnce({ success: false })
    mockRevertInvitationResend.mockResolvedValueOnce(false)
    expect((await callResend()).status).toBe(409)
  })
})
