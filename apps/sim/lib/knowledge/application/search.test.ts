import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  billingUsageGateCacheMock,
  billingUsageGateCacheMockFns,
} from '@sim/testing/mocks/billing-usage-gate-cache.mock'
import {
  billingUsageMonitorMock,
  billingUsageMonitorMockFns,
} from '@sim/testing/mocks/billing-usage-monitor.mock'
import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import {
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { getMockPlatformEvent, telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const hoisted = vi.hoisted(() => ({
  hasRerankerCredential: vi.fn(async () => true),
  getKnowledgeBase: vi.fn(),
  executeSearch: vi.fn(),
  retrieval: vi.fn(),
  getTagDefinitions: vi.fn(),
  importProvenance: vi.fn(),
  rerank: vi.fn(),
  recordActivity: vi.fn(),
}))

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/knowledge/search/activity', () => ({
  recordOrganizationSearchActivity: hoisted.recordActivity,
}))

vi.mock('@/lib/knowledge/reranker', () => ({
  hasRerankerCredential: hoisted.hasRerankerCredential,
  rerank: hoisted.rerank,
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)

/** Retrieval defaults are the flag's concern; here the flag is off so the search stays as configured. */
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)

vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

vi.mock('@/lib/knowledge/search/queries', () => ({
  generateSearchEmbedding: knowledgeEmbeddingsMockFns.mockGenerateSearchEmbedding,
  retrieveKnowledgeSearch: async (...args: unknown[]) => ({
    rows: await hoisted.executeSearch(...args),
    retrieval: hoisted.retrieval(),
    readAccess: (args[0] as { access: unknown }).access,
  }),
}))

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

vi.mock('@/lib/knowledge/tags/utils', () => ({
  buildUndefinedTagsError: (tags: string[]) => `Undefined tags: ${tags.join(', ')}`,
  validateTagValue: () => null,
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  importKnowledgeSearchResultSecretProvenance: hoisted.importProvenance,
}))

import { searchKnowledge } from '@/lib/knowledge/application/search'

const mocks = {
  ...hoisted,
  checkUsage: billingUsageGateCacheMockFns.mockCheckSearchUsageLimits,
  checkActorUsage: billingUsageMonitorMockFns.mockCheckActorUsageLimits,
}

const mockGetActiveKnowledgeBaseReferences =
  knowledgeServiceMockFns.mockGetActiveKnowledgeBaseReferences
const mockGenerateSearchEmbedding = knowledgeEmbeddingsMockFns.mockGenerateSearchEmbedding
const mockRecordSearchEmbeddingUsage = knowledgeEmbeddingsMockFns.mockRecordSearchEmbeddingUsage
const mockGetDocumentTagDefinitionsByKnowledgeBaseIds =
  knowledgeTagsServiceMockFns.mockGetDocumentTagDefinitionsByKnowledgeBaseIds

knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockImplementation(
  async () => false
)
billingAttributionMockFns.mockResolveSystemBillingAttribution.mockImplementation(
  (...args: unknown[]) => billingAttributionMockFns.mockResolveBillingAttribution(...args)
)
billingAttributionMockFns.mockResolveOrganizationBillingAttribution.mockImplementation(
  (...args: unknown[]) => billingAttributionMockFns.mockResolveBillingAttribution(...args)
)

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const knowledgeBase = {
  id: 'knowledge-1',
  userId: 'user-1',
  name: 'Docs',
  workspaceId: 'workspace-1',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
}

describe('knowledge search application use case', () => {
  beforeEach(() => {
    mocks.retrieval.mockReturnValue({ status: 'complete', timedOutLegs: [] })
    mocks.rerank.mockReset()
    resetDbChainMock()
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockResolvedValue(undefined)
    knowledgeContextsMockFns.mockResolveKnowledgeOrganizationContext.mockResolvedValue({
      organizationId: 'org-canonical',
      workspaceId: undefined,
    })
    knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue(workspace)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mockGetActiveKnowledgeBaseReferences.mockImplementation((ids: string[]) =>
      Promise.all(ids.map((id) => mocks.getKnowledgeBase(id)))
    )
    mockGetDocumentTagDefinitionsByKnowledgeBaseIds.mockImplementation(
      async (ids: string[]) =>
        new Map(await Promise.all(ids.map(async (id) => [id, await mocks.getTagDefinitions(id)])))
    )
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
    mocks.checkActorUsage.mockResolvedValue({ isExceeded: false })
    mockGenerateSearchEmbedding.mockResolvedValue({ embedding: [0.1], isBYOK: false })
    mocks.executeSearch.mockResolvedValue([
      {
        id: 'embedding-1',
        documentId: 'document-1',
        knowledgeBaseId: 'knowledge-1',
        content: 'answer',
        chunkIndex: 0,
        distance: 0.2,
        filename: 'guide.pdf',
        sourceUrl: null,
        connectorType: null,
        tag1: null,
        tag2: null,
        tag3: null,
        tag4: null,
        tag5: null,
        tag6: null,
        tag7: null,
        number1: null,
        number2: null,
        number3: null,
        number4: null,
        number5: null,
        date1: null,
        date2: null,
        boolean1: null,
        boolean2: null,
        boolean3: null,
      },
    ])
    mocks.getTagDefinitions.mockResolvedValue([])
    mockRecordSearchEmbeddingUsage.mockResolvedValue(undefined)
    mocks.importProvenance.mockResolvedValue({ imported: true, documentMetadata: {} })
  })

  it.each([false, true])(
    'requires explicit partial-result support for empty incomplete searches (allowPartialResults=%s)',
    async (allowPartialResults) => {
      mocks.retrieval.mockReturnValue({ status: 'partial', timedOutLegs: ['vector', 'keyword'] })
      mocks.executeSearch.mockResolvedValue([])
      const result = searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'canaries',
          topK: 20,
          allowPartialResults,
        },
      })

      if (!allowPartialResults) {
        await expect(result).rejects.toThrow('retrieval deadline')
        return
      }
      await expect(result).resolves.toMatchObject({
        results: [],
        totalResults: 0,
        retrieval: { status: 'partial', timedOutLegs: ['vector', 'keyword'] },
      })
    }
  )

  describe.each(['workspace', 'organization'] as const)('%s ranking policy', (scope) => {
    beforeEach(() => {
      if (scope === 'organization') {
        mocks.getKnowledgeBase.mockResolvedValue({
          ...knowledgeBase,
          workspaceId: null,
          organizationId: 'org-canonical',
          isSearchIndex: true,
        })
        queueTableRows(member, [{ role: 'member' }])
      }
    })

    it('meters only successful organization calls under the acting person', async () => {
      await searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: { knowledgeBaseIds: ['knowledge-1'], query: 'answer', topK: 10, surface: 'mcp' },
      })
      if (scope === 'organization') {
        expect(mocks.recordActivity).toHaveBeenCalledExactlyOnceWith({
          organizationId: 'org-canonical',
          userId: 'user-1',
          surface: 'mcp',
          results: expect.any(Array),
        })
      } else {
        expect(mocks.recordActivity).not.toHaveBeenCalled()
      }
    })

    const _principal = createSessionPrincipal()
    const _input = { knowledgeBaseIds: ['knowledge-1'], query: 'answer', topK: 10 }
  })

  it('gates organization search using the persisted owner even when the request omits it', async () => {
    mocks.getKnowledgeBase.mockResolvedValue({
      ...knowledgeBase,
      workspaceId: null,
      organizationId: 'org-canonical',
    })
    queueTableRows(member, [{ role: 'member' }])
    knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable.mockRejectedValue(
      new OrchestrationError('forbidden', 'Search is not enabled for this organization')
    )
    await expect(
      searchKnowledge.execute({
        principal: createPersonalApiKeyPrincipal(),
        input: { knowledgeBaseIds: ['knowledge-1'], query: 'answer', topK: 5 },
      })
    ).rejects.toThrow('Search is not enabled for this organization')
    expect(mocks.recordActivity).not.toHaveBeenCalled()
    expect(
      knowledgeAvailabilityMockFns.mockRequireOrganizationSearchAvailable
    ).toHaveBeenCalledExactlyOnceWith('org-canonical')
    expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('authorizes every canonical knowledge base before billing and search', async () => {
    const result = await searchKnowledge.execute({
      principal: createSessionPrincipal(),
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
      },
    })

    expect(
      workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mock.invocationCallOrder[0]
    ).toBeLessThan(
      billingAttributionMockFns.mockResolveBillingAttribution.mock.invocationCallOrder[0]
    )
    expect(
      billingAttributionMockFns.mockResolveBillingAttribution.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.executeSearch.mock.invocationCallOrder[0])
    expect(mocks.executeSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseIds: ['knowledge-1'],
        topK: 5,
        searchMode: 'vector',
        boostRecency: false,
      })
    )
    expect(result.results[0]).toMatchObject({
      embeddingId: 'embedding-1',
      documentId: 'document-1',
      similarity: 0.8,
    })
    expect(result.knowledgeBases).toEqual([{ id: 'knowledge-1', name: 'Docs' }])
    expect(getMockPlatformEvent('knowledgeBaseSearched')).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseIds: ['knowledge-1'],
        documentIds: ['document-1'],
        resultsCount: 1,
        actorUserId: 'user-1',
        principalKind: 'session',
      })
    )
  })

  it('rejects a cross-workspace knowledge base before authorization or spend', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      ...knowledgeBase,
      workspaceId: 'workspace-2',
    })

    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission).not.toHaveBeenCalled()
    expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('attributes workspace-key searches to the key scope without identifying the payer as the reader', async () => {
    await searchKnowledge.execute({
      principal: createWorkspaceApiKeyPrincipal(),
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
      },
    })
    expect(getMockPlatformEvent('knowledgeBaseSearched')).toHaveBeenCalledWith(
      expect.objectContaining({
        principalKind: 'workspace_api_key',
        accessScopeKind: 'workspace',
        actorUserId: undefined,
        documentIds: ['document-1'],
      })
    )
  })

  it('refuses an already-cancelled search before starting billable provider work', async () => {
    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          signal: AbortSignal.abort(new Error('Cancelled fixture search')),
        },
      })
    ).rejects.toThrow('Cancelled fixture search')
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it.each(['user-1', 'other-user'])(
    'conceals an unscoped knowledge base before billing or search for %s',
    async (userId) => {
      mocks.getKnowledgeBase.mockResolvedValueOnce({
        ...knowledgeBase,
        workspaceId: null,
        organizationId: null,
      })

      await expect(
        searchKnowledge.execute({
          principal: { kind: 'session', userId, sessionId: 'session-1' },
          input: { knowledgeBaseIds: ['knowledge-1'], query: 'answer', topK: 5 },
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
      expect(mocks.checkActorUsage).not.toHaveBeenCalled()
      expect(mocks.executeSearch).not.toHaveBeenCalled()
    }
  )

  it('enforces semantic knowledge-base and result bounds for trusted callers', async () => {
    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: Array.from({ length: 21 }, (_, index) => `knowledge-${index}`),
          query: 'answer',
          topK: 5,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 101,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext).not.toHaveBeenCalled()
    expect(mocks.getKnowledgeBase).not.toHaveBeenCalled()
    expect(mockGetActiveKnowledgeBaseReferences).not.toHaveBeenCalled()
    expect(mockGetDocumentTagDefinitionsByKnowledgeBaseIds).not.toHaveBeenCalled()
  })

  it('rejects a batch spanning different canonical workspaces before billing', async () => {
    mockGetActiveKnowledgeBaseReferences.mockResolvedValue([
      knowledgeBase,
      { ...knowledgeBase, id: 'knowledge-2', workspaceId: 'workspace-2' },
    ])

    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: { knowledgeBaseIds: ['knowledge-1', 'knowledge-2'], query: 'answer', topK: 5 },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Selected knowledge bases must belong to the same workspace',
    })
    expect(billingAttributionMockFns.mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('rejects multi-knowledge-base tag filters without embedding spend', async () => {
    mocks.getKnowledgeBase
      .mockResolvedValueOnce(knowledgeBase)
      .mockResolvedValueOnce({ ...knowledgeBase, id: 'knowledge-2' })

    await expect(
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
          topK: 5,
          tagFilters: [{ tagName: 'team', operator: 'eq', value: 'docs' }],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('verifies trusted result provenance inside the authorized use case', async () => {
    const registry = { markIncomplete: vi.fn() }
    await searchKnowledge.execute({
      principal: createSessionPrincipal(),
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
        resultSecretRegistry: registry as never,
      },
    })

    expect(mocks.importProvenance).toHaveBeenCalledWith({
      registry,
      results: expect.arrayContaining([
        expect.objectContaining({ id: 'embedding-1', documentId: 'document-1' }),
      ]),
    })
  })

  describe('rankScore and rank name the order results came back in', () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: 'embedding-1',
      documentId: 'document-1',
      knowledgeBaseId: 'knowledge-1',
      content: 'answer',
      chunkIndex: 0,
      distance: 0.2,
      tag1: null,
      tag2: null,
      tag3: null,
      tag4: null,
      tag5: null,
      tag6: null,
      tag7: null,
      number1: null,
      number2: null,
      number3: null,
      number4: null,
      number5: null,
      date1: null,
      date2: null,
      boolean1: null,
      boolean2: null,
      boolean3: null,
      ...overrides,
    })
    const search = (input: Record<string, unknown> = {}) =>
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          ...input,
        },
      })

    it('passes the hybrid fused score through as rankScore while similarity stays the cosine value', async () => {
      mocks.executeSearch.mockResolvedValue([
        row({ id: 'embedding-1', distance: 0.2, rankScore: 1 / 61 + 1 / 62, rank: 1 }),
        row({
          id: 'embedding-2',
          documentId: 'document-1',
          distance: 0.05,
          rankScore: 1 / 62,
          rank: 2,
        }),
      ])

      const result = await search({ searchMode: 'hybrid' })

      expect(result.results.map((item) => item.rank)).toEqual([1, 2])
      expect(result.results[0]).toMatchObject({ similarity: 0.8, rankScore: 1 / 61 + 1 / 62 })
      expect(result.results[1]).toMatchObject({ similarity: 0.95, rankScore: 1 / 62 })
    })

    it('reports the reranker score as rankScore once a reranker has ordered the results', async () => {
      mocks.executeSearch.mockResolvedValue([row({ rankScore: 0.8, rank: 1 })])
      mocks.rerank.mockResolvedValueOnce({
        results: [{ item: { id: 'embedding-1' }, relevanceScore: 0.93 }],
        isBYOK: false,
      })

      const result = await search({ rerankerEnabled: true, rerankerModel: 'rerank-v4.0-pro' })

      expect(result.results[0]).toMatchObject({
        similarity: 0.8,
        rankScore: 0.93,
        rerankerScore: 0.93,
        rank: 1,
      })
    })
  })

  describe('reranker outcome reporting', () => {
    const rerankedSearch = (rerankerEnabled?: boolean, query: string | undefined = 'answer') =>
      searchKnowledge.execute({
        principal: createSessionPrincipal(),
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          ...(query === undefined ? {} : { query }),
          topK: 5,
          ...(rerankerEnabled === undefined ? {} : { rerankerEnabled }),
          rerankerModel: 'rerank-v4.0-pro' as const,
        },
      })

    /**
     * The reproduced defect: a deployment with no Cohere credential threw inside
     * `rerank`, the use case swallowed it, and the caller got a 200 whose results
     * were byte-identical to an unreranked search with nothing to distinguish them.
     */
    it('never calls the reranker when neither the workspace nor the platform holds a key', async () => {
      mocks.hasRerankerCredential.mockResolvedValueOnce(false)

      const result = await rerankedSearch(true)

      /** A caller's own key is judged by the same policy the resolver applies, not taken on faith. */
      expect(mocks.hasRerankerCredential).toHaveBeenLastCalledWith(expect.anything(), undefined)
      expect(mocks.rerank).not.toHaveBeenCalled()
      expect(result.rerankerStatus).toBe('unavailable')
      expect(result.results[0]).not.toHaveProperty('rerankerScore')
    })

    it('reports unavailable rather than silently falling back to vector ordering', async () => {
      mocks.rerank.mockRejectedValueOnce(new Error('No Cohere API key configured.'))

      const result = await rerankedSearch(true)

      expect(result.rerankerStatus).toBe('unavailable')
      expect(result.results[0]).not.toHaveProperty('rerankerScore')
    })
  })
})
