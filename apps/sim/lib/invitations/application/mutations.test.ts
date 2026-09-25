import { recordAudit } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invitation: vi.fn(),
  org: vi.fn(),
  workspace: vi.fn(),
  context: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@sim/audit', async (original) => ({
  ...(await original<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/core/application/organization-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/organization-authorization')>()),
  authorizeOrganizationOperation: mocks.org,
}))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mocks.workspace,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/invitations/core', () => ({ getInvitationById: mocks.invitation }))
vi.mock('@/lib/invitations/mutation-manager', () => ({
  resendInvitationRecord: mocks.resend,
  revokeInvitationRecord: mocks.revoke,
}))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application/workspace-authorization'
import { resendInvitation, revokeInvitation } from '@/lib/invitations/application/mutations'

const session: Principal = { kind: 'session', userId: 'actor', sessionId: 'session' }
const key: Principal = { kind: 'personal_api_key', userId: 'actor', keyId: 'key' }
const oauth: Principal = {
  kind: 'oauth_access_token',
  userId: 'actor',
  tokenId: 'token',
  clientId: 'client',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
}
const inv = {
  id: 'invite',
  kind: 'workspace',
  organizationId: 'org',
  email: 'person@example.com',
  role: 'member',
  membershipIntent: 'internal',
  grants: [{ workspaceId: 'one' }, { workspaceId: 'two' }],
}
const input = { invitationId: 'invite' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.invitation.mockResolvedValue(inv)
  mocks.context.mockImplementation(async (workspaceId) => ({
    workspaceId,
    workspaceOrganizationId: 'org',
    allowPersonalApiKeys: true,
  }))
  mocks.resend.mockResolvedValue(inv)
  mocks.revoke.mockResolvedValue({ success: true, invitation: inv, invitationCancelled: true })
})

describe('shared invitation administration', () => {
  it('retains any-workspace resend, every-workspace revoke, and scoped revocation authority', async () => {
    mocks.org.mockRejectedValue(
      new ForbiddenOperationError('ORGANIZATION_ADMIN_REQUIRED', 'Admin required')
    )
    mocks.workspace.mockImplementation(async (_principal, _operation, context) => {
      if (context.workspaceId === 'two') throw new InsufficientWorkspacePermissionsError()
    })
    await resendInvitation.execute({ principal: session, input })
    expect(mocks.resend).toHaveBeenCalledOnce()
    await expect(revokeInvitation.execute({ principal: session, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.revoke).not.toHaveBeenCalled()
    mocks.revoke.mockResolvedValue({ success: true, invitation: inv, invitationCancelled: false })
    await revokeInvitation.execute({ principal: session, input: { ...input, workspaceId: 'one' } })
    expect(mocks.revoke).toHaveBeenCalledWith({
      ...input,
      workspaceId: 'one',
      actorUserId: 'actor',
    })
    expect(recordAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: 'one',
        resourceId: 'one',
        metadata: expect.objectContaining({ invitationCancelled: false }),
      })
    )
  })

  it.each([
    new ForbiddenOperationError('PERMISSION_GROUP_CAPABILITY_BLOCKED', 'Withheld'),
    new Error('Database unavailable'),
  ])('does not fall back after credential/capability or infrastructure refusal', async (error) => {
    mocks.org.mockRejectedValue(error)
    await expect(resendInvitation.execute({ principal: session, input })).rejects.toBe(error)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('conceals asserted organization mismatch before authorization', async () => {
    await expect(
      resendInvitation.execute({
        principal: key,
        input: { ...input, assertedOrganizationId: 'other' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.org).not.toHaveBeenCalled()
  })

  it.each([session, key, oauth])(
    'attributes successful mutations to the real $kind actor and canonical workspace',
    async (principal) => {
      await resendInvitation.execute({
        principal,
        input: { ...input, assertedOrganizationId: 'org' },
      })
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          workspaceId: 'one',
          resourceId: 'one',
          resourceType: 'workspace',
          metadata: expect.objectContaining({
            actor: expect.objectContaining({ kind: principal.kind }),
            operation: 'invitations.resend',
          }),
        })
      )
    }
  )

  it.each(['resend', 'revoke'] as const)(
    'keeps organization %s audits outside workspace scope',
    async (action) => {
      const organizationInvitation = { ...inv, kind: 'organization' }
      mocks.invitation.mockResolvedValue(organizationInvitation)
      mocks.resend.mockResolvedValue(organizationInvitation)
      mocks.revoke.mockResolvedValue({
        success: true,
        invitation: organizationInvitation,
        invitationCancelled: true,
      })
      const useCase = action === 'resend' ? resendInvitation : revokeInvitation
      await useCase.execute({ principal: session, input })
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: null,
          resourceId: 'org',
          resourceType: 'organization',
        })
      )
    }
  )

  it('keeps explicitly scoped organization-invitation revocation on the selected workspace', async () => {
    const organizationInvitation = { ...inv, kind: 'organization' }
    mocks.invitation.mockResolvedValue(organizationInvitation)
    mocks.revoke.mockResolvedValue({
      success: true,
      invitation: organizationInvitation,
      invitationCancelled: false,
    })
    await revokeInvitation.execute({ principal: session, input: { ...input, workspaceId: 'two' } })
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'two',
        resourceId: 'two',
        resourceType: 'workspace',
      })
    )
  })
})
