import type { OrganizationDelegatedPrincipal, SessionPrincipal } from '@sim/auth/principal'
import {
  auditMock,
  auditMockFns,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  group: vi.fn(),
  setup: vi.fn(),
  write: vi.fn(),
  policy: vi.fn(),
  accountsGroup: vi.fn(),
  invite: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: mocks.setup,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: vi.fn(),
  getOrganizationAccountsGroup: mocks.accountsGroup,
  updateCredentialGroup: vi.fn(),
}))
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: mocks.invite,
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.policy,
  writeResourcePolicy: mocks.write,
  ResourcePolicyRevisionConflictError: class extends Error {},
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getOrganizationAccountWorkspaceAccess,
  updateOrganizationAccountWorkspaceAccess,
} from '@/lib/credential-groups/application/organization-access'
import {
  getOrganizationAccountsSettings,
  startOrganizationAccountConnection,
} from '@/lib/credential-groups/application/organization-accounts'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { ORGANIZATION_CREDENTIAL_TYPES } from '@/lib/credential-groups/credential-types'
import { ResourcePolicyRevisionConflictError } from '@/lib/resource-policies/repository'

const principal: SessionPrincipal = {
  kind: 'session',
  userId: 'admin-user',
  sessionId: 'session-1',
}
const input = {
  organizationId: 'org-1',
  revision: 3,
  grants: [
    {
      workspaceId: 'workspace-1',
      access: { mode: 'selected' as const, credentialTypes: ['oauth:gmail' as const] },
    },
  ],
}
const delegated: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  organizationId: 'org-1',
  subjectUserId: 'real-actor',
  delegationId: 'settings-call',
  audience: 'sim:settings',
  resourceScope: { chatId: 'chat-1' },
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
}

describe('organization workspace sharing administration', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({
      credentialGroupId: 'group-1',
      name: 'Accounts',
      status: 'active',
    })
    mocks.setup.mockResolvedValue(undefined)
    mocks.policy.mockResolvedValue({
      revision: 3,
      document: buildOrganizationAccountAccessPolicy('group-1', []),
    })
    mocks.write.mockImplementation(async ({ document }) => ({ revision: 4, document }))
  })

  it('reauthorizes the delegated human and attributes a workspace access change to that actor', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    await updateOrganizationAccountWorkspaceAccess.execute({ principal: delegated, input })
    expect(eq).toHaveBeenCalledWith(schemaMock.member.userId, 'real-actor')
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'real-actor', organizationId: 'org-1' })
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'real-actor',
        metadata: expect.objectContaining({
          operation: 'organization_accounts.workspace_access.update',
          actor: expect.objectContaining({
            kind: 'organization_delegated',
            subjectUserId: 'real-actor',
          }),
        }),
      })
    )
  })

  it.each(['member', null])(
    'does not preserve an outdated delegated admin grant: %s',
    async (role) => {
      queueTableRows(schemaMock.member, role ? [{ role }] : [])
      await expect(
        updateOrganizationAccountWorkspaceAccess.execute({ principal: delegated, input })
      ).rejects.toThrow()
      expect(mocks.write).not.toHaveBeenCalled()
      expect(mocks.group).not.toHaveBeenCalled()
    }
  )

  it.each([
    { organizationId: 'foreign' },
    { audience: 'sim:search' },
    { expiresAt: new Date(0) },
    { resourceScope: {} },
  ])('rejects invalid delegation before loading connected accounts: %j', async (override) => {
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({
        principal: { ...delegated, ...override },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.each(['member', null])(
    'denies management by a %s before loading account data',
    async (role) => {
      queueTableRows(schemaMock.member, role ? [{ role }] : [])
      await expect(
        updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
      ).rejects.toThrow()
      expect(mocks.group).not.toHaveBeenCalled()
      expect(mocks.write).not.toHaveBeenCalled()
    }
  )

  it('returns only the acting member account metadata for the canonical organization group, even when providers are disabled', async () => {
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    mocks.accountsGroup.mockResolvedValue({ id: 'group-1', status: 'disabled', options: [] })
    const account = {
      credentialId: 'credential-1',
      displayName: 'My GitHub',
      providerId: 'github-repositories',
      groupId: 'group-1',
      optionId: 'option-1',
      status: 'needs_reauth',
    }
    queueTableRows(schemaMock.credential, [])
    queueTableRows(schemaMock.credential, [account])
    const result = await getOrganizationAccountsSettings.execute({
      principal,
      input: { organizationId: 'org-1' },
    })
    expect(result.viewerAccounts).toEqual([account])
    expect(result.canManage).toBe(false)
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroup.id, 'group-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'admin-user')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.organizationId, 'org-1')
  })

  it('starts an active account through the existing enrollment OAuth boundary', async () => {
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    mocks.accountsGroup.mockResolvedValue({
      id: 'group-1',
      status: 'active',
      options: [{ id: 'option-1', status: 'active' }],
    })
    mocks.invite.mockResolvedValue({
      invitationLink: 'https://sim.test/credential-groups/enroll/fixture-token',
    })
    await expect(
      startOrganizationAccountConnection.execute({
        principal,
        input: { organizationId: 'org-1', optionId: 'option-1' },
      })
    ).resolves.toEqual({
      invitationLink:
        'https://sim.test/credential-groups/enroll/fixture-token?optionId=option-1&returnTo=search',
      authorizationUrl:
        'https://sim.test/api/credential-groups/enroll/fixture-token/oauth/option-1?returnTo=search',
    })
  })

  it('starts only an enabled MCP provider belonging to the canonical organization group', async () => {
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    mocks.accountsGroup.mockResolvedValue({
      id: 'group-1',
      status: 'active',
      options: [],
      mcpServers: [{ id: 'coda-server', enabled: true }],
    })
    mocks.invite.mockResolvedValue({
      invitationLink: 'https://sim.test/credential-groups/enroll/fixture-token',
    })
    expect(
      await startOrganizationAccountConnection.execute({
        principal,
        input: { organizationId: 'org-1', mcpServerId: 'coda-server' },
      })
    ).toMatchObject({
      authorizationUrl:
        'https://sim.test/api/credential-groups/enroll/fixture-token/mcp/coda-server',
    })
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    await expect(
      startOrganizationAccountConnection.execute({
        principal,
        input: { organizationId: 'org-1', mcpServerId: 'another-server' },
      })
    ).rejects.toThrow('no longer available')
    expect(mocks.invite).toHaveBeenCalledTimes(1)
  })

  it('does not issue a direct authorization link when enrollment access was revoked', async () => {
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    mocks.accountsGroup.mockResolvedValue({
      id: 'group-1',
      status: 'active',
      options: [{ id: 'option-1', status: 'active' }],
    })
    mocks.invite.mockRejectedValue(new OrchestrationError('forbidden', 'Enrollment revoked'))
    await expect(
      startOrganizationAccountConnection.execute({
        principal,
        input: { organizationId: 'org-1', optionId: 'option-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('uses the routed org and checks every workspace before granting access', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).resolves.toMatchObject({
      revision: 4,
      grants: [
        {
          workspaceId: 'workspace-1',
          access: { mode: 'selected' as const, credentialTypes: ['oauth:gmail' as const] },
        },
      ],
    })
    expect(eq).toHaveBeenCalledWith(schemaMock.member.userId, 'admin-user')
    expect(eq).toHaveBeenCalledWith(schemaMock.member.organizationId, 'org-1')
    expect(eq).toHaveBeenCalledWith(schemaMock.workspace.organizationId, 'org-1')
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorUserId: 'admin-user',
        expectedRevision: 3,
        document: buildOrganizationAccountAccessPolicy('group-1', input.grants),
      })
    )
  })

  it('refuses foreign or archived workspaces without writing a policy', async () => {
    queueTableRows(schemaMock.member, [{ role: 'owner' }])
    queueTableRows(schemaMock.workspace, [])
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toThrow('Every allowed workspace')
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('rejects selected grants exceeding the persisted policy size bound before writing', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    const grants = Array.from({ length: 1000 }, (_, index) => ({
      workspaceId: `workspace-${index}`,
      access: { mode: 'selected' as const, credentialTypes: [...ORGANIZATION_CREDENTIAL_TYPES] },
    }))
    queueTableRows(
      schemaMock.workspace,
      grants.map((grant) => ({ id: grant.workspaceId }))
    )
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({ principal, input: { ...input, grants } })
    ).rejects.toMatchObject({ code: 'validation', message: expect.stringContaining('too large') })
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('rejects a stale revision rather than overwriting another admin', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.write.mockRejectedValue(new ResourcePolicyRevisionConflictError())
    await expect(
      updateOrganizationAccountWorkspaceAccess.execute({
        principal,
        input: { ...input, grants: [] },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('fails closed when the flag is disabled or legacy setup is unresolved', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.available.mockResolvedValue(false)
    await expect(
      getOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.group).not.toHaveBeenCalled()
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.available.mockResolvedValue(true)
    mocks.setup.mockRejectedValue(new Error('Migration review required'))
    await expect(
      getOrganizationAccountWorkspaceAccess.execute({ principal, input })
    ).rejects.toThrow('Migration review required')
    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.workspace)
  })
})
