/** @vitest-environment node */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireOrganizationAccountRuntimePolicy } from '@/lib/credential-groups/application/resolve-organization-access-policy'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceGrants,
  organizationAccountPolicyAllowsWorkspace,
} from '@/lib/credential-groups/application/workspace-access-policy'

const { requirePolicy } = vi.hoisted(() => ({ requirePolicy: vi.fn() }))
vi.mock('@/lib/resource-policies/repository', () => ({ requireResourcePolicy: requirePolicy }))

const input = {
  organizationId: 'org-1',
  resourceType: 'credential_group' as const,
  resourceId: 'group-1',
}

describe('organization credential project inheritance', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.clearAllMocks()
  })

  it('resolves newly added environments and removes inherited access when membership disappears', async () => {
    requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy(
        'group-1',
        [],
        [{ projectId: 'project-1', access: { mode: 'all' } }]
      ),
      revision: 3,
    })
    queueTableRows(schemaMock.project, [{ projectId: 'project-1', workspaceId: 'prod' }])
    const before = await requireOrganizationAccountRuntimePolicy(input)
    expect(organizationAccountPolicyAllowsWorkspace(before.document, 'new-env')).toBe(false)
    queueTableRows(schemaMock.project, [
      { projectId: 'project-1', workspaceId: 'prod' },
      { projectId: 'project-1', workspaceId: 'new-env' },
    ])
    const after = await requireOrganizationAccountRuntimePolicy(input)
    expect(organizationAccountPolicyAllowsWorkspace(after.document, 'new-env')).toBe(true)
    queueTableRows(schemaMock.project, [])
    const removed = await requireOrganizationAccountRuntimePolicy(input)
    expect(organizationAccountPolicyAllowsWorkspace(removed.document, 'prod')).toBe(false)
    expect(after.revision).toBe(3)
  })

  it('preserves explicit integration grants while adding project grants', async () => {
    requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy(
        'group-1',
        [{ workspaceId: 'prod', access: { mode: 'selected', credentialTypes: ['oauth:gmail'] } }],
        [{ projectId: 'project-1', access: { mode: 'selected', credentialTypes: ['oauth:slack'] } }]
      ),
    })
    queueTableRows(schemaMock.project, [
      { projectId: 'project-1', workspaceId: 'prod' },
      { projectId: 'project-1', workspaceId: 'new-env' },
    ])
    const resolved = await requireOrganizationAccountRuntimePolicy(input)
    const grants = listOrganizationAccountWorkspaceGrants(resolved.document)
    expect(grants.find((grant) => grant.workspaceId === 'prod')?.access).toEqual({
      mode: 'selected',
      credentialTypes: ['oauth:gmail', 'oauth:slack'],
    })
    expect(grants.find((grant) => grant.workspaceId === 'new-env')?.access).toEqual({
      mode: 'selected',
      credentialTypes: ['oauth:slack'],
    })
    expect(organizationAccountPolicyAllowsWorkspace(resolved.document, 'unrelated')).toBe(false)
  })
})
