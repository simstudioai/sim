import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { credentialGroupsAvailabilityMock } from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/credential-groups/application/context', () => ({
  resolveCredentialGroupWorkspaceContext: async () => ({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: 'org-1',
    allowPersonalApiKeys: true,
  }),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)

import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
import { getWorkspaceOrganizationAccounts } from '@/lib/credential-groups/application/workspace-organization-accounts'

const mocks = {
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  policy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
}

function read() {
  return getWorkspaceOrganizationAccounts.execute({
    principal: createSessionPrincipal(),
    input: { workspaceId: 'workspace-1' },
  })
}

describe('workspace organization provider projection', () => {
  beforeEach(() => {
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
})
