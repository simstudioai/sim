/** @vitest-environment node */
import { member, user } from '@sim/db/schema'
import { authMockFns, createMockRequest, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  revoke: vi.fn(),
  admission: vi.fn(),
  orgAdmin: vi.fn(),
  workspaceAdmin: vi.fn(),
  policy: vi.fn(),
  workspace: vi.fn(),
  validate: vi.fn(),
  subscription: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  persist: vi.fn(),
  audit: vi.fn(),
  workspaceRole: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/platform-authz/workspace')>()),
  resolveEffectiveWorkspacePermission: mocks.workspaceRole,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
  }),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/invitations/core', () => ({
  getInvitationById: mocks.get,
  revokeInvitationAsAdmin: mocks.revoke,
  resolveInvitationAdmissionOrganizationId: mocks.admission,
}))
vi.mock('@/lib/invitations/send', () => ({
  prepareInvitationResend: mocks.prepare,
  sendInvitationEmail: mocks.send,
  persistInvitationResend: mocks.persist,
}))
vi.mock('@/lib/billing/core/organization', () => ({ isOrganizationOwnerOrAdmin: mocks.orgAdmin }))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  hasWorkspaceAdminAccess: mocks.workspaceAdmin,
  getWorkspaceWithOwner: mocks.workspace,
}))
vi.mock('@/lib/workspaces/policy', () => ({ getWorkspaceInvitePolicy: mocks.policy }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  InvitationsNotAllowedError: class extends Error {},
  validateInvitationsAllowed: mocks.validate,
}))
vi.mock('@sim/audit', () => ({
  AuditAction: {
    INVITATION_REVOKED: 'invitation.revoked',
    ORG_INVITATION_REVOKED: 'org.revoked',
    ORG_INVITATION_RESENT: 'org.resent',
    INVITATION_RESENT: 'invitation.resent',
  },
  AuditResourceType: { ORGANIZATION: 'organization', WORKSPACE: 'workspace' },
  recordAudit: mocks.audit,
}))

import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelInvitation,
  cancelWorkspaceInvitation,
  InvitationManagementError,
  resendInvitation,
  resendWorkspaceInvitation,
} from '@/lib/invitations/application/manage-invitation'
import { invitationManagementErrorPolicy } from '@/lib/invitations/management-error-policy'
import { DELETE } from '@/app/api/invitations/[id]/route'

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
  grants: [],
  membershipIntent: 'internal',
}
beforeEach(() => {
  vi.clearAllMocks()
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
  mocks.persist.mockResolvedValue(undefined)
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

  it('resends a matching workspace invitation through the existing delivery lifecycle', async () => {
    mocks.get.mockResolvedValue({
      ...invitation,
      kind: 'workspace',
      grants: [{ workspaceId: 'workspace', permission: 'read' }],
    })
    mocks.workspace.mockResolvedValue({ id: 'workspace', organizationId: 'org' })
    mocks.policy.mockResolvedValue({ allowed: true })
    await resendWorkspaceInvitation.execute({ principal: actor, input: target })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          operation: 'workspace_invitations.resend',
          actor: expect.objectContaining({ kind: 'delegated' }),
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
  it('resends through existing policy, email and token persistence without returning token material', async () => {
    queueTableRows(member, [{ role: 'owner' }])
    const result = await resendInvitation.execute({ principal, input })
    expect(result).toEqual({ success: true })
    expect(mocks.validate).toHaveBeenCalledWith('actor', { organizationId: 'org' })
    expect(mocks.send).toHaveBeenCalledBefore(mocks.persist)
    expect(mocks.persist).toHaveBeenCalledBefore(mocks.audit)
    expect(JSON.stringify(result)).not.toContain('private')
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
  it('does not persist a new token or audit when delivery fails', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.send.mockResolvedValueOnce({ success: false, error: 'Delivery unavailable' })
    await expect(resendInvitation.execute({ principal, input })).rejects.toMatchObject({
      status: 502,
    })
    expect(mocks.persist).not.toHaveBeenCalled()
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
  it('keeps the internal HTTP cancellation on the same semantic operation', async () => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'session-actor' },
      session: { id: 'session' },
    })
    const response = await DELETE(
      createMockRequest(
        'DELETE',
        undefined,
        {},
        `http://localhost/api/invitations/${input.invitationId}`
      ),
      { params: Promise.resolve({ id: input.invitationId }) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, invitationCancelled: true })
    expect(mocks.revoke).toHaveBeenCalledWith({
      actorId: 'session-actor',
      invitationId: input.invitationId,
    })
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
