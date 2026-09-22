/** @vitest-environment node */
import { recordAudit } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { member, user } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  prepare: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  members: vi.fn(),
  organizations: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/organizations/member-manager', () => ({
  updateOrganizationMemberRecord: mocks.update,
  removeOrganizationMemberRecord: mocks.remove,
}))
vi.mock('@/lib/invitations/organization-invitations', () => ({
  prepareOrganizationInvitationContext: mocks.prepare,
  createOrganizationInvitation: mocks.create,
}))
vi.mock('@/lib/organizations/member-queries', () => ({ readOrganizationMemberPage: mocks.members }))
vi.mock('@/lib/organizations/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/organizations/queries')>()),
  listOrganizationRecordsForUser: mocks.organizations,
}))

import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { createOrganizationInvitation } from '@/lib/organizations/application/invitations'
import {
  removeOrganizationMember,
  updateOrganizationMember,
} from '@/lib/organizations/application/members'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { listOrganizationMembers, listOrganizations } from '@/lib/organizations/application/reads'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const session: Principal = { kind: 'session', userId: 'actor', sessionId: 'current-session' }
const key: Principal = { kind: 'personal_api_key', userId: 'actor', keyId: 'key' }
const oauth: Principal = {
  kind: 'oauth_access_token',
  userId: 'actor',
  clientId: 'client',
  tokenId: 'token',
  scopes: ['api:read', 'api:write'],
  expiresAt: new Date('2099-01-01'),
}
const roleInput = { organizationId: 'org', userId: 'target', role: 'admin' as const }
const inviteInput = { organizationId: 'org', email: 'person@example.com', role: 'member' as const }
const target = {
  id: 'membership',
  userId: 'target',
  organizationId: 'org',
  role: 'member',
  userName: 'Person',
  userEmail: 'person@example.com',
  createdAt: new Date('2026-01-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.config.mockResolvedValue(null)
  mocks.update.mockResolvedValue({
    member: { ...target, role: 'admin' },
    previousRole: 'member',
    changed: true,
  })
  mocks.remove.mockResolvedValue({
    target,
    membershipType: 'internal',
    removal: { success: true },
    seatReduction: null,
  })
  mocks.prepare.mockImplementation(async (value) => value)
  mocks.create.mockResolvedValue({ id: 'invitation', email: inviteInput.email })
  mocks.members.mockResolvedValue({ data: [], nextCursorKeys: null })
})

describe('organization application operations', () => {
  it.each([session, key, oauth])(
    'uses the real $kind actor for role changes and semantic audit',
    async (principal) => {
      queueTableRows(member, [{ role: 'admin' }])
      await updateOrganizationMember.execute({ principal, input: roleInput })
      expect(mocks.update).toHaveBeenCalledWith({ ...roleInput, actorUserId: 'actor' })
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor',
          resourceId: 'org',
          metadata: expect.objectContaining({
            operation: 'organizations.members.update',
            actor: expect.objectContaining({ kind: principal.kind }),
          }),
        })
      )
    }
  )

  it.each(Object.values(organizationOperations))(
    'rejects workspace principals for $id',
    async (operation) => {
      expect(operation.principalKinds).not.toContain('workspace_api_key')
    }
  )

  it('rejects workspace keys before protected loading', async () => {
    await expect(
      updateOrganizationMember.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace', keyId: 'workspace-key' },
        input: roleInput,
      })
    ).rejects.toMatchObject({ detailCode: 'PRINCIPAL_KIND_NOT_PERMITTED' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('conceals other organizations and requires an administrator for role changes', async () => {
    await expect(
      updateOrganizationMember.execute({ principal: key, input: roleInput })
    ).rejects.toMatchObject({ code: 'not_found' })
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      updateOrganizationMember.execute({ principal: key, input: roleInput })
    ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each([
    [key, { disablePersonalApiKeys: true }],
    [oauth, { disableOAuthAppAccess: true }],
    [{ ...oauth, clientId: SIM_CLI_CLIENT_ID }, { disableCliAccess: true }],
  ] as const)('rechecks current credential policy', async (principal, restriction) => {
    queueTableRows(member, [{ role: 'owner' }])
    mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, ...restriction })
    await expect(
      updateOrganizationMember.execute({ principal, input: roleInput })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('requires write scope before membership or mutation loading', async () => {
    await expect(
      updateOrganizationMember.execute({
        principal: { ...oauth, scopes: ['api:read'] },
        input: roleInput,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('preserves audit on a successful same-role request', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.update.mockResolvedValueOnce({
      member: { ...target, role: 'admin' },
      previousRole: 'admin',
      changed: false,
    })
    await updateOrganizationMember.execute({ principal: session, input: roleInput })
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actorId: 'actor',
        resourceId: 'org',
        metadata: expect.objectContaining({
          changes: [{ field: 'role', from: 'admin', to: 'admin' }],
        }),
      })
    )
  })

  it('does not audit a failed role write', async () => {
    queueTableRows(member, [{ role: 'admin' }])
    mocks.update.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(
      updateOrganizationMember.execute({ principal: session, input: roleInput })
    ).rejects.toThrow('database unavailable')
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it('allows self-removal and preserves only the acting session by verified row ID', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await removeOrganizationMember.execute({
      principal: session,
      input: { organizationId: 'org', userId: 'actor' },
    })
    expect(mocks.remove).toHaveBeenCalledWith({
      organizationId: 'org',
      userId: 'actor',
      actorUserId: 'actor',
      spareSessionId: 'current-session',
    })
  })

  it('does not let members remove somebody else or preserve a session on credential-based removal', async () => {
    queueTableRows(member, [{ role: 'member' }])
    await expect(
      removeOrganizationMember.execute({ principal: session, input: roleInput })
    ).rejects.toMatchObject({ detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    expect(mocks.remove).not.toHaveBeenCalled()
    queueTableRows(member, [{ role: 'admin' }])
    await removeOrganizationMember.execute({ principal: key, input: roleInput })
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.not.objectContaining({ spareSessionId: expect.anything() })
    )
  })

  it.each(['admin', 'owner'])(
    'retains member-directory access for %s when directory visibility is disabled',
    async (role) => {
      queueTableRows(member, [{ role }])
      mocks.config.mockResolvedValue({
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        hideOrgMemberDirectory: true,
      })
      await listOrganizationMembers.execute({
        principal: key,
        input: { organizationId: 'org', sortBy: 'name', sortOrder: 'asc', limit: 10 },
      })
      expect(mocks.members).toHaveBeenCalledOnce()
    }
  )

  it('denies directory access to a restricted member and suppresses non-admin usage enrichment', async () => {
    queueTableRows(member, [{ role: 'member' }])
    mocks.config.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideOrgMemberDirectory: true,
    })
    await expect(
      listOrganizationMembers.execute({
        principal: session,
        input: { organizationId: 'org', sortBy: 'name', sortOrder: 'asc', limit: 10 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    mocks.config.mockResolvedValue(null)
    queueTableRows(member, [{ role: 'member' }])
    await listOrganizationMembers.execute({
      principal: session,
      input: {
        organizationId: 'org',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 10,
        includeUsage: true,
      },
    })
    expect(mocks.members).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ includeUsage: false })
    )
  })

  it.each([session, key, oauth])(
    'creates invitations with $kind audit attribution after delivery',
    async (principal) => {
      queueTableRows(member, [{ role: 'admin' }])
      queueTableRows(user, [{ name: 'Acting Admin', email: 'admin@example.com' }])
      await createOrganizationInvitation.execute({ principal, input: inviteInput })
      expect(mocks.create).toHaveBeenCalledWith({
        context: expect.objectContaining({ inviterId: 'actor', organizationId: 'org' }),
        email: inviteInput.email,
        role: 'member',
      })
      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            actor: expect.objectContaining({ kind: principal.kind }),
            invitationId: 'invitation',
          }),
        })
      )
    }
  )

  it('withheld invitations prevent creation', async () => {
    mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, disableInvitations: true })
    queueTableRows(member, [{ role: 'admin' }])
    await expect(
      createOrganizationInvitation.execute({ principal: key, input: inviteInput })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('filters inaccessible organizations without concealing infrastructure failures', async () => {
    mocks.organizations.mockResolvedValue({
      data: [{ id: 'org', name: 'Organization' }],
      nextCursorKeys: null,
    })
    queueTableRows(member, [])
    await expect(
      listOrganizations.execute({
        principal: key,
        input: { sortBy: 'name', sortOrder: 'asc', limit: 1 },
      })
    ).resolves.toMatchObject({ data: [], nextCursorKeys: null })
    dbChainMockFns.select.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(
      listOrganizations.execute({
        principal: key,
        input: { sortBy: 'name', sortOrder: 'asc', limit: 1 },
      })
    ).rejects.toThrow('database unavailable')
  })
  it('fills pages after filtering and anchors cursors only to authorized organizations', async () => {
    mocks.organizations
      .mockResolvedValueOnce({
        data: [{ id: 'hidden', name: 'Hidden' }],
        nextCursorKeys: ['Hidden', 'hidden'],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'one', name: 'One', role: 'admin' }],
        nextCursorKeys: ['One', 'one'],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'two', name: 'Two', role: 'admin' }],
        nextCursorKeys: null,
      })
    queueTableRows(member, [])
    queueTableRows(member, [{ role: 'member' }])
    queueTableRows(member, [{ role: 'admin' }])
    const result = await listOrganizations.execute({
      principal: key,
      input: { sortBy: 'name', sortOrder: 'asc', limit: 1 },
    })
    expect(result).toEqual({
      data: [{ id: 'one', name: 'One', role: 'member' }],
      nextCursorKeys: ['One', 'one'],
    })
  })
})
