import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), approved: vi.fn(), available: vi.fn() }))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireSourceMirroredAccessAvailable: mocks.available,
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.context,
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  searchIntegrationAccessCondition: mocks.approved,
}))

import { loadLiveGitHubSources, loadLiveServiceSource } from '@/lib/sim-search/live/service-sources'

describe('service source canonical namespace', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.context.mockResolvedValue({ workspaceOrganizationId: 'org' })
    mocks.available.mockResolvedValue(undefined)
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
    expect(mocks.context).toHaveBeenCalledWith({ workspaceId: 'workspace' })
    expect(mocks.available).toHaveBeenCalledWith({ organizationId: 'org' })
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
    mocks.available.mockRejectedValueOnce(new Error('Administrator access is not available'))
    await expect(
      loadLiveServiceSource({ organizationId: 'org' }, 'gmail', 'source')
    ).rejects.toThrow('Administrator access is not available')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
  it('requires organization membership and refuses unavailable sources', async () => {
    mocks.context.mockResolvedValue({ workspaceOrganizationId: null })
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
    mocks.context.mockResolvedValue({ workspaceOrganizationId: 'org' })
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
    expect(mocks.available).not.toHaveBeenCalled()
  })

  it('refuses a missing organization or more repositories than policy can represent', async () => {
    mocks.context.mockResolvedValue({ workspaceOrganizationId: null })
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
