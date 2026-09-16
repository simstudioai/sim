/** @vitest-environment node */
import { auditMock, auditMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  group: vi.fn(),
  readiness: vi.fn(),
  feature: vi.fn(),
  setIndexing: vi.fn(),
  dispatch: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: mocks.available,
}))
vi.mock('@/lib/credential-groups/credentials', () => ({
  loadScopedAccountsCredentialListContext: mocks.group,
}))
vi.mock('@/lib/credential-groups/organization-setup', () => ({
  requireOrganizationAccountsSetup: mocks.readiness,
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/credential-groups/service', () => ({
  ensureWorkspaceAccountsGroup: vi.fn(),
  getOrganizationAccountsGroup: vi.fn(),
  updateCredentialGroup: vi.fn(),
}))
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: vi.fn(),
}))
vi.mock('@/lib/credential-groups/managed-mcp-service', () => ({
  ManagedMcpConnectorError: class extends Error {},
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireKnowledgeMemberAccessAvailable: mocks.feature,
  isKnowledgeMemberAccessAvailable: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/organization-account-indexing', () => ({
  setOrganizationAccountIndexing: mocks.setIndexing,
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({
  dispatchMemberSyncsForCredentialOption: mocks.dispatch,
}))

import { updateOrganizationAccountIndexing } from '@/lib/credential-groups/application/organization-account-indexing'

const principal = { kind: 'session' as const, userId: 'admin-1', sessionId: 'session-1' }
const input = { organizationId: 'org-1', optionId: 'option-1', enabled: true }

describe('organization account indexing authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    mocks.feature.mockResolvedValue(undefined)
    mocks.setIndexing.mockResolvedValue({
      enabled: true,
      changed: true,
      providerName: 'Gmail',
      knowledgeBaseIds: ['kb-1'],
    })
  })
  it.each(['member', null])('denies a %s before reading account data', async (role) => {
    queueTableRows(schemaMock.member, role ? [{ role }] : [])
    await expect(updateOrganizationAccountIndexing.execute({ principal, input })).rejects.toThrow()
    expect(mocks.group).not.toHaveBeenCalled()
    expect(mocks.setIndexing).not.toHaveBeenCalled()
  })
  it.each(['owner', 'admin'])(
    'allows an org %s and dispatches only that organization option',
    async (role) => {
      queueTableRows(schemaMock.member, [{ role }])
      await updateOrganizationAccountIndexing.execute({ principal, input })
      expect(mocks.setIndexing).toHaveBeenCalledWith({ ...input, credentialGroupId: 'group-1' })
      expect(mocks.dispatch).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialGroupOptionId: 'option-1',
      })
      expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'admin-1', metadata: { organizationId: 'org-1' } })
      )
    }
  )
  it('requires indexing availability to enable a source', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.feature.mockRejectedValue(new Error('Search is not enabled'))
    await expect(updateOrganizationAccountIndexing.execute({ principal, input })).rejects.toThrow(
      'Search is not enabled'
    )
    expect(mocks.setIndexing).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('allows pausing when the Search feature is off and does not dispatch', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.setIndexing.mockResolvedValue({
      enabled: false,
      changed: true,
      providerName: 'Gmail',
      knowledgeBaseIds: ['kb-1'],
    })
    await updateOrganizationAccountIndexing.execute({
      principal,
      input: { ...input, enabled: false },
    })
    expect(mocks.feature).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('does not audit or redispatch an unchanged setting', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.setIndexing.mockResolvedValue({
      enabled: true,
      changed: false,
      providerName: 'Gmail',
      knowledgeBaseIds: ['kb-1'],
    })
    await updateOrganizationAccountIndexing.execute({ principal, input })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('does not audit or dispatch a failed mutation', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    mocks.setIndexing.mockRejectedValue(new Error('Sync already in progress'))
    await expect(updateOrganizationAccountIndexing.execute({ principal, input })).rejects.toThrow(
      'Sync already in progress'
    )
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
