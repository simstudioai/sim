import { db } from '@sim/db'
import { member, user } from '@sim/db/schema'
import { authMockFns, createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { billingCoreMock } from '@sim/testing/mocks/billing-core.mock'
import {
  billingOrganizationMock,
  billingOrganizationMockFns,
} from '@sim/testing/mocks/billing-organization.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  invitationsSendMock,
  invitationsSendMockFns,
} from '@sim/testing/mocks/invitations-send.mock'
import {
  MockInvitationsNotAllowedError,
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/lib/invitations/send', () => invitationsSendMock)
vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { lockInvitationResendPolicy } from '@/lib/invitations/resend-policy'
import type { PreparedInvitationResend } from '@/lib/invitations/send'
import { POST } from '@/app/api/invitations/[id]/resend/route'

const { mockGetWorkspaceInvitePolicy } = workspacesPolicyMockFns
const { mockSendInvitationEmail, mockPrepareInvitationResend, mockRevertInvitationResend } =
  invitationsSendMockFns
const { mockGetInvitationById, mockResolveInvitationAdmissionOrganizationId } =
  invitationsCoreMockFns
const { mockIsOrganizationOwnerOrAdmin } = billingOrganizationMockFns

const mockGetSession = authMockFns.mockGetSession
const mockHasWorkspaceAdminAccess = permissionsMockFns.mockHasWorkspaceAdminAccess
const mockGetWorkspaceWithOwner = permissionsMockFns.mockGetWorkspaceWithOwner
const mockValidateInvitationsAllowed = permissionCheckMockFns.mockValidateInvitationsAllowed

function callResend() {
  return POST(
    createMockRequest(
      'POST',
      undefined,
      {},
      'http://localhost:3000/api/invitations/11111111-1111-4111-8111-111111111111/resend'
    ),
    createRouteContext({ id: '11111111-1111-4111-8111-111111111111' })
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

  it('reports a conflict when failed delivery cannot be compensated over newer state', async () => {
    mockSendInvitationEmail.mockResolvedValueOnce({ success: false })
    mockRevertInvitationResend.mockResolvedValueOnce(false)
    expect((await callResend()).status).toBe(409)
  })
})
