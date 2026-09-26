import type { Principal } from '@sim/auth/principal'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import {
  invitationsCoreMock,
  invitationsCoreMockFns,
} from '@sim/testing/mocks/invitations-core.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  resend: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
vi.mock('@/lib/invitations/core', () => invitationsCoreMock)
vi.mock('@/lib/invitations/mutation-manager', () => ({
  resendInvitationRecord: hoisted.resend,
  revokeInvitationRecord: hoisted.revoke,
}))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { InsufficientWorkspacePermissionsError } from '@/lib/core/application/workspace-authorization'
import { resendInvitation, revokeInvitation } from '@/lib/invitations/application/mutations'

const mocks = {
  ...hoisted,
  invitation: invitationsCoreMockFns.mockGetInvitationById,
  workspace: workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation,
  org: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
  context: workspaceContextMockFns.mockLoadWorkspaceApplicationContext,
}
const recordAudit = auditMockFns.mockRecordAudit

const session: Principal = createSessionPrincipal({ userId: 'actor', sessionId: 'session' })
const key: Principal = createPersonalApiKeyPrincipal({ userId: 'actor', keyId: 'key' })
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
