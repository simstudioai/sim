/** @vitest-environment node */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ group: vi.fn(), policy: vi.fn() }))
vi.mock('@/lib/credential-groups/application/context', () => ({
  resolveCredentialGroupWorkspaceContext: async () => ({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: 'org-1',
    allowPersonalApiKeys: true,
  }),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: vi.fn().mockResolvedValue('read'),
  permissionSatisfies: (permission: string, required: string) => permission === required,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/resource-policies/repository', () => ({ requireResourcePolicy: mocks.policy }))

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { getWorkspaceOrganizationAccounts } from '@/lib/credential-groups/application/workspace-organization-accounts'

function read() {
  return getWorkspaceOrganizationAccounts.execute({
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    input: { workspaceId: 'workspace-1' },
  })
}

describe('workspace organization provider projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(schemaMock.organization, [{ name: 'Organization' }])
    queueTableRows(schemaMock.member, [{ role: 'member' }])
    queueTableRows(schemaMock.mcpServers, [{ connectorId: 'fireflies' }])
    mocks.group.mockResolvedValue({
      credentialGroupId: 'group-1',
      status: 'active',
      options: [
        { provider: 'gmail', status: 'active' },
        { provider: 'google-calendar', status: 'active' },
        { provider: 'retired-provider', status: 'disabled' },
      ],
    })
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        { workspaceId: 'workspace-1', access: { mode: 'all' } },
      ]),
    })
  })

  it('ignores disabled legacy options before validating active providers', async () => {
    const result = await read()
    expect(result.providers.map(({ id }) => id)).toEqual(['google-email', 'google-calendar'])
    expect(result.mcpProviders.map(({ id }) => id)).toEqual(['fireflies'])
  })

  it('projects only credential types allowed for the current workspace', async () => {
    mocks.policy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: 'workspace-1',
          access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
        },
      ]),
    })
    const result = await read()
    expect(result.allowed).toBe(true)
    expect(result.providers.map(({ id }) => id)).toEqual(['google-email'])
    expect(result.mcpProviders).toEqual([])
  })

  it('fails fast for an unregistered active provider', async () => {
    mocks.group.mockResolvedValue({
      credentialGroupId: 'group-1',
      status: 'active',
      options: [{ provider: 'unknown', status: 'active' }],
    })
    await expect(read()).rejects.toThrow('Unsupported organization provider: unknown')
  })
})
