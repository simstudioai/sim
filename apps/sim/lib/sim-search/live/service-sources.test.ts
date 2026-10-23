import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)

import { loadLiveGitHubSources, loadLiveServiceSource } from '@/lib/sim-search/live/service-sources'

const mocks = {
  approved: knowledgeSearchIntegrationPolicyMockFns.mockSearchIntegrationAccessCondition,
}

describe('service source canonical namespace', () => {
  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
      workspaceOrganizationId: 'org',
    })
    knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable.mockResolvedValue(
      undefined
    )
  })
  it('derives organization scope from the canonical workspace before binding source ID and provider', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      { id: 'source', sourceConfig: { label: 'INBOX' } },
    ])
    expect(
      await loadLiveServiceSource({ workspaceId: 'workspace' }, 'gmail', 'source')
    ).toMatchObject({
      organizationId: 'org',
      config: { label: 'INBOX' },
    })
    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).toHaveBeenCalledWith({
      workspaceId: 'workspace',
    })
    expect(
      knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable
    ).toHaveBeenCalledWith({ organizationId: 'org' })
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeBase.organizationId, 'org')
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeBase.isSearchIndex, true)
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeConnector.id, 'source')
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeConnector.connectorType, 'gmail')
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeConnector.accessMode, 'admin')
    expect(eq).not.toHaveBeenCalledWith(schemaMock.knowledgeConnector.accessRewritePending, false)
    expect(isNull).toHaveBeenCalledWith(schemaMock.knowledgeConnector.deletedAt)
    expect(isNull).toHaveBeenCalledWith(schemaMock.knowledgeConnector.archivedAt)
    expect(mocks.approved).toHaveBeenCalledOnce()
  })
  it('rechecks source-mode availability before loading the credential', async () => {
    knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable.mockRejectedValueOnce(
      new Error('Administrator access is not available')
    )
    await expect(
      loadLiveServiceSource({ organizationId: 'org' }, 'gmail', 'source')
    ).rejects.toThrow('Administrator access is not available')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('requires organization membership and refuses unavailable sources', async () => {
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
      workspaceOrganizationId: null,
    })
    await expect(
      loadLiveServiceSource({ workspaceId: 'personal' }, 'gmail', 'source')
    ).rejects.toThrow('requires an organization source')
    queueTableRows(schemaMock.knowledgeConnector, [])
    await expect(
      loadLiveServiceSource({ organizationId: 'org' }, 'gmail', 'foreign-source')
    ).rejects.toThrow('source is unavailable')
  })
  it('lets the authorized settings operation validate a disabled source before reenabling it', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'source', sourceConfig: {} }])
    await loadLiveServiceSource({ organizationId: 'org' }, 'gmail', 'source', {
      requireApproved: false,
    })
    expect(mocks.approved).not.toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeConnector.accessMode, 'admin')
  })
})

describe('GitHub App repository inventory', () => {
  beforeEach(() => {
    resetDbChainMock()
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
      workspaceOrganizationId: 'org',
    })
  })

  it('loads only organization Search installation sources and includes no member observations', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        id: 'repo-source',
        sourceConfig: { repository: 'acme/project', githubRepositoryId: '123' },
        credentialId: 'installation',
      },
    ])
    const rows = await loadLiveGitHubSources({ organizationId: 'org' })
    expect(rows).toMatchObject([
      { id: 'repo-source', config: { repository: 'acme/project', githubRepositoryId: '123' } },
    ])
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeBase.organizationId, 'org')
    expect(eq).toHaveBeenCalledWith(schemaMock.knowledgeConnector.accessMode, 'members')
    expect(eq).toHaveBeenCalledWith(schemaMock.credential.providerId, 'github-app-installation')
    expect(mocks.approved).toHaveBeenCalledOnce()
    expect(
      knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable
    ).not.toHaveBeenCalled()
  })

  it('refuses a missing organization or more repositories than policy can represent', async () => {
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
      workspaceOrganizationId: null,
    })
    await expect(loadLiveGitHubSources({ workspaceId: 'personal' })).rejects.toThrow(
      'requires an organization'
    )
    queueTableRows(
      schemaMock.knowledgeConnector,
      Array.from({ length: 101 }, (_, index) => ({ id: `source-${index}` }))
    )
    await expect(loadLiveGitHubSources({ organizationId: 'org' })).rejects.toThrow(
      'up to 100 configured repositories'
    )
  })
})
