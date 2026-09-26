import { member, user } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { billingCoreMock, billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
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
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { workspaceContextMock } from '@sim/testing/mocks/workspace-context.mock'
import {
  workspacesPolicyMock,
  workspacesPolicyMockFns,
} from '@sim/testing/mocks/workspaces-policy.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/lib/invitations/send', () => invitationsSendMock)
vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)
vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workspaces/policy', () => workspacesPolicyMock)
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@sim/audit', () => auditMock)

import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelInvitation,
  cancelWorkspaceInvitation,
  InvitationManagementError,
  resendInvitation,
  resendWorkspaceInvitation,
} from '@/lib/invitations/application/manage-invitation'
import { invitationManagementErrorPolicy } from '@/lib/invitations/management-error-policy'

const mocks = {
  orgAdmin: billingOrganizationMockFns.mockIsOrganizationOwnerOrAdmin,
  subscription: billingCoreMockFns.mockGetOrganizationSubscription,
  get: invitationsCoreMockFns.mockGetInvitationById,
  revoke: invitationsCoreMockFns.mockRevokeInvitationAsAdmin,
  admission: invitationsCoreMockFns.mockResolveInvitationAdmissionOrganizationId,
  policy: workspacesPolicyMockFns.mockGetWorkspaceInvitePolicy,
  prepare: invitationsSendMockFns.mockPrepareInvitationResend,
  send: invitationsSendMockFns.mockSendInvitationEmail,
  revert: invitationsSendMockFns.mockRevertInvitationResend,
  workspaceAdmin: permissionsMockFns.mockHasWorkspaceAdminAccess,
  workspace: permissionsMockFns.mockGetWorkspaceWithOwner,
  validate: permissionCheckMockFns.mockValidateInvitationsAllowed,
  audit: auditMockFns.mockRecordAudit,
  workspaceRole: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'actor',
  organizationId: 'org',
  delegationId: 'invitations',
  audience: 'sim:settings',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
} as const
const input = { invitationId: '11111111-1111-4111-8111-111111111111', organizationId: 'org' }
const invitation = {
  id: input.invitationId,
  organizationId: 'org',
  kind: 'organization',
  role: 'member',
  email: 'invited@example.com',
  token: 'private-old-token',
  status: 'pending',
  expiresAt: new Date(Date.now() + 60_000),
  updatedAt: new Date(),
  createdAt: new Date(),
  grants: [],
  membershipIntent: 'internal',
}
beforeEach(() => {
  resetDbChainMock()
  mocks.get.mockResolvedValue(invitation)
  mocks.revoke.mockResolvedValue({ success: true, invitation, invitationCancelled: true })
  mocks.orgAdmin.mockResolvedValue(true)
  mocks.workspaceRole.mockResolvedValue('admin')
  mocks.admission.mockResolvedValue('org')
  mocks.subscription.mockResolvedValue({ plan: 'team', status: 'active' })
  mocks.prepare.mockResolvedValue({
    tokenForEmail: 'private-link',
    nextToken: 'private-new-token',
    nextExpiresAt: new Date(),
  })
  mocks.send.mockResolvedValue({ success: true })
  mocks.revert.mockResolvedValue(true)
  queueTableRows(user, [{ name: 'Real actor', email: 'actor@example.com' }])
})

describe('workspace invitation management authority', () => {
  const actor = {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'actor',
    workspaceId: 'workspace',
    delegationId: 'call',
    audience: 'sim:settings',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  } as const
  const target = { invitationId: input.invitationId, workspaceId: 'workspace' }

  it('cancels only the explicit workspace grant and records the delegated actor', async () => {
    await cancelWorkspaceInvitation.execute({ principal: actor, input: target })
    expect(mocks.revoke).toHaveBeenCalledWith({
      actorId: 'actor',
      invitationId: target.invitationId,
      workspaceId: 'workspace',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          operation: 'workspace_invitations.cancel',
          actor: expect.objectContaining({ kind: 'delegated' }),
          workspaceId: 'workspace',
        }),
      })
    )
  })

  it.each([
    [],
    [{ workspaceId: 'foreign', permission: 'read' }],
    [
      { workspaceId: 'workspace', permission: 'read' },
      { workspaceId: 'foreign', permission: 'read' },
    ],
  ])('does not rotate or deliver a token outside the scoped grants', async (grants) => {
    mocks.get.mockResolvedValue({ ...invitation, grants })
    await expect(
      resendWorkspaceInvitation.execute({ principal: actor, input: target })
    ).rejects.toThrow()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each([cancelWorkspaceInvitation, resendWorkspaceInvitation])(
    'rechecks current admin authority for %s',
    async (useCase) => {
      mocks.workspaceRole.mockResolvedValue('write')
      await expect(useCase.execute({ principal: actor, input: target })).rejects.toThrow()
      expect(mocks.revoke).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
    }
  )
})
describe('invitation management application authority', () => {
  it('uses the trusted org in the locked cancellation and audits current actor', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    await expect(cancelInvitation.execute({ principal, input })).resolves.toEqual({
      success: true,
      invitationCancelled: true,
    })
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith({
      actorId: 'actor',
      invitationId: input.invitationId,
      organizationId: 'org',
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'actor', actorName: 'Real actor' })
    )
  })
  it.each([cancelInvitation, resendInvitation])(
    'refuses ordinary members before any invitation mutation',
    async (useCase) => {
      queueTableRows(member, [{ role: 'member' }])
      await expect(useCase.execute({ principal, input })).rejects.toMatchObject({
        code: 'forbidden',
      })
      expect(mocks.revoke).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
      expect(mocks.get).not.toHaveBeenCalled()
    }
  )
  it('conceals another organization invitation before email generation', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.get.mockResolvedValueOnce({ ...invitation, organizationId: 'foreign' })
    await expect(resendInvitation.execute({ principal, input })).rejects.toMatchObject({
      status: 404,
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('reverts the prepared token without auditing when delivery fails', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.send.mockResolvedValueOnce({ success: false, error: 'Delivery unavailable' })
    await expect(resendInvitation.execute({ principal, input })).rejects.toMatchObject({
      status: 502,
    })
    expect(mocks.revert).toHaveBeenCalledWith(await mocks.prepare.mock.results[0].value)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('refuses forged organization and workspace authority before cancellation', async () => {
    await expect(
      cancelInvitation.execute({ principal, input: { ...input, organizationId: 'foreign' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      cancelInvitation.execute({ principal, input: { ...input, workspaceId: 'workspace' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.revoke).not.toHaveBeenCalled()
  })
})

it.each([
  { status: 400, code: 'validation' },
  { status: 403, code: 'forbidden' },
  { status: 404, code: 'not_found' },
  { status: 409, code: 'conflict' },
  { status: 502, code: 'internal' },
])(
  'projects typed invitation status $status without losing domain metadata',
  ({ status, code }) => {
    const error = new InvitationManagementError(status, 'Action unavailable', true)
    expect(asOrchestrationError(error)).toMatchObject({ code, message: 'Action unavailable' })
    expect(invitationManagementErrorPolicy.project(error)).toEqual({
      status,
      body: { error: 'Action unavailable', upgradeRequired: true },
    })
  }
)
