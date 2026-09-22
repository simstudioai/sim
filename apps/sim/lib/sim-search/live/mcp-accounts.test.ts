/** @vitest-environment node */
import { queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), policy: vi.fn(), runtime: vi.fn() }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.context,
}))
vi.mock('@/lib/credential-groups/application/organization-workspace-access', () => ({
  requireOrganizationAccountsWorkspaceAccess: mocks.policy,
}))
vi.mock('@/lib/credentials/managed-mcp', () => ({
  loadScopedManagedMcpRuntimeCredential: mocks.runtime,
  ManagedMcpCredentialError: class extends Error {},
}))

import {
  listCodaMcpSearchAccounts,
  loadOwnCodaMcpRuntime,
} from '@/lib/sim-search/live/mcp-accounts'

const row = {
  id: 'mine',
  displayName: 'Coda',
  workspaceId: null,
  organizationId: 'org',
  groupId: 'group',
}
describe('Coda personal search authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.context.mockResolvedValue({ workspaceId: 'workspace', workspaceOrganizationId: 'org' })
    mocks.policy.mockResolvedValue({})
    mocks.runtime.mockResolvedValue({ credentialType: 'mcp:coda' })
  })
  it('filters by the acting person and applies organization workspace grants before discovery', async () => {
    queueTableRows(schemaMock.credential, [row])
    expect(await listCodaMcpSearchAccounts({ workspaceId: 'workspace' }, 'person')).toMatchObject([
      { id: 'mine', type: 'managed_mcp' },
    ])
    expect(eq).toHaveBeenCalledWith(schemaMock.credentialGroupEnrollment.userId, 'person')
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        organizationId: 'org',
        credentialGroupId: 'group',
      }),
      'mcp:coda'
    )
    expect(mocks.runtime).not.toHaveBeenCalled()
  })
  it('does not expose or decrypt grants rejected by workspace policy', async () => {
    queueTableRows(schemaMock.credential, [row])
    mocks.policy.mockRejectedValue(new Error('denied'))
    expect(await listCodaMcpSearchAccounts({ workspaceId: 'workspace' }, 'person')).toEqual([])
    expect(mocks.runtime).not.toHaveBeenCalled()
  })
  it('supports organization search without inventing a workspace and binds token resolution to the person', async () => {
    queueTableRows(schemaMock.credential, [row])
    await loadOwnCodaMcpRuntime({ organizationId: 'org' }, 'person', 'mine')
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.runtime).toHaveBeenCalledWith(
      'mine',
      { kind: 'organization', organizationId: 'org' },
      'person'
    )
  })
  it('rejects references to credentials outside the fresh own-account listing', async () => {
    queueTableRows(schemaMock.credential, [row])
    await expect(
      loadOwnCodaMcpRuntime({ organizationId: 'org' }, 'person', 'someone-else')
    ).rejects.toThrow('no longer available')
    expect(mocks.runtime).not.toHaveBeenCalled()
  })
})
