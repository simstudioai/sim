import { auditMock, auditMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import { credentialGroupsOrganizationSetupMock } from '@sim/testing/mocks/credential-groups-organization-setup.mock'
import { credentialGroupsSelfEnrollmentMock } from '@sim/testing/mocks/credential-groups-self-enrollment.mock'
import { credentialGroupsServiceMock } from '@sim/testing/mocks/credential-groups-service.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeMemberQueueMock,
  knowledgeMemberQueueMockFns,
} from '@sim/testing/mocks/knowledge-member-queue.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  setIndexing: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credential-groups/organization-setup', () => credentialGroupsOrganizationSetupMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/credential-groups/service', () => credentialGroupsServiceMock)
vi.mock('@/lib/credential-groups/provider-availability', () => ({
  listConfiguredCredentialGroupProviders: vi.fn(),
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => credentialGroupsSelfEnrollmentMock)
vi.mock('@/lib/credential-groups/managed-mcp-service', () => ({
  ManagedMcpConnectorError: class extends Error {},
}))
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/connectors/organization-account-indexing', () => ({
  setOrganizationAccountIndexing: hoisted.setIndexing,
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => knowledgeMemberQueueMock)

import { updateOrganizationAccountIndexing } from '@/lib/credential-groups/application/organization-account-indexing'

const mocks = {
  ...hoisted,
  available: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
  group: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  dispatch: knowledgeMemberQueueMockFns.mockDispatchMemberSyncsForCredentialOption,
}

const feature = knowledgeAvailabilityMockFns.mockRequireKnowledgeMemberAccessAvailable
const principal = createSessionPrincipal({ userId: 'admin-1' })
const input = { organizationId: 'org-1', optionId: 'option-1', enabled: true }

describe('organization account indexing authorization', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.available.mockResolvedValue(true)
    mocks.group.mockResolvedValue({ credentialGroupId: 'group-1' })
    feature.mockResolvedValue(undefined)
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
  it('allows an org admin and dispatches only that organization option', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    await updateOrganizationAccountIndexing.execute({ principal, input })
    expect(mocks.setIndexing).toHaveBeenCalledWith({ ...input, credentialGroupId: 'group-1' })
    expect(mocks.dispatch).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialGroupOptionId: 'option-1',
    })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        metadata: {
          organizationId: 'org-1',
          operation: 'organization_accounts.indexing.update',
          actor: { kind: 'session', userId: 'admin-1' },
        },
      })
    )
  })
  it('requires indexing availability to enable a source', async () => {
    queueTableRows(schemaMock.member, [{ role: 'admin' }])
    feature.mockRejectedValue(new Error('Search is not enabled'))
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
    expect(feature).not.toHaveBeenCalled()
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
})
