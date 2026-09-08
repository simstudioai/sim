/**
 * @vitest-environment node
 */

import { member } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  resolveOrganization: vi.fn(),
  requireOrganizationSearch: vi.fn(),
  resolvePermission: vi.fn(),
  getKnowledgeBase: vi.fn(),
  resolveBilling: vi.fn(),
  checkUsage: vi.fn(),
  checkActorUsage: vi.fn(),
  generateEmbedding: vi.fn(),
  executeSearch: vi.fn(),
  getDocumentMetadata: vi.fn(),
  getTagDefinitions: vi.fn(),
  recordEmbeddingUsage: vi.fn(),
  importProvenance: vi.fn(),
  rerank: vi.fn(),
  searched: vi.fn(),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseSearched: mocks.searched },
}))

vi.mock('@/lib/knowledge/reranker', () => ({
  rerank: mocks.rerank,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveBilling,
  resolveSystemBillingAttribution: mocks.resolveBilling,
  checkAttributedUsageLimits: mocks.checkUsage,
}))

/** Retrieval defaults are the flag's concern; here the flag is off so the search stays as configured. */
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: async () => false,
  requireOrganizationSearchAvailable: mocks.requireOrganizationSearch,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mocks.checkActorUsage,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
  resolveKnowledgeOrganizationContext: mocks.resolveOrganization,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfig: async () => null,
  getUserPermissionConfigForOrganization: async () => null,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mocks.getKnowledgeBase,
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: mocks.generateEmbedding,
  recordSearchEmbeddingUsage: mocks.recordEmbeddingUsage,
}))

vi.mock('@/lib/knowledge/search/queries', () => ({
  generateSearchEmbedding: mocks.generateEmbedding,
  executeKnowledgeSearch: mocks.executeSearch,
  getDocumentMetadataByIds: mocks.getDocumentMetadata,
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mocks.getTagDefinitions,
}))

vi.mock('@/lib/knowledge/tags/utils', () => ({
  buildUndefinedTagsError: (tags: string[]) => `Undefined tags: ${tags.join(', ')}`,
  validateTagValue: () => null,
}))

vi.mock('@/lib/knowledge/secret-provenance', () => ({
  importKnowledgeSearchResultSecretProvenance: mocks.importProvenance,
}))

import { searchKnowledge } from '@/lib/knowledge/application/search'

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
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.requireOrganizationSearch.mockResolvedValue(undefined)
    mocks.resolveOrganization.mockResolvedValue({
      organizationId: 'org-canonical',
      workspaceId: undefined,
    })
    mocks.resolveWorkspace.mockResolvedValue(workspace)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getKnowledgeBase.mockResolvedValue(knowledgeBase)
    mocks.resolveBilling.mockResolvedValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.checkUsage.mockResolvedValue({ isExceeded: false })
    mocks.checkActorUsage.mockResolvedValue({ isExceeded: false })
    mocks.generateEmbedding.mockResolvedValue({ embedding: [0.1], isBYOK: false })
    mocks.executeSearch.mockResolvedValue([
      {
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
      },
    ])
    mocks.getDocumentMetadata.mockResolvedValue({
      'document-1': { filename: 'guide.pdf', sourceUrl: null },
    })
    mocks.getTagDefinitions.mockResolvedValue([])
    mocks.recordEmbeddingUsage.mockResolvedValue(undefined)
    mocks.importProvenance.mockResolvedValue({ imported: true, documentMetadata: {} })
  })

  it('drops passages whose access was revoked before the final document metadata read', async () => {
    mocks.getDocumentMetadata.mockResolvedValue({})
    const result = await searchKnowledge.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'orion',
        topK: 20,
      },
    })
    expect(result.results).toEqual([])
    expect(result.totalResults).toBe(0)
  })

  it('gates organization search using the persisted owner even when the request omits it', async () => {
    mocks.getKnowledgeBase.mockResolvedValue({
      ...knowledgeBase,
      workspaceId: null,
      organizationId: 'org-canonical',
    })
    queueTableRows(member, [{ role: 'member' }])
    mocks.requireOrganizationSearch.mockRejectedValue(
      new OrchestrationError('forbidden', 'Search is not enabled for this organization')
    )
    await expect(
      searchKnowledge.execute({
        principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
        input: { knowledgeBaseIds: ['knowledge-1'], query: 'answer', topK: 5 },
      })
    ).rejects.toThrow('Search is not enabled for this organization')
    expect(mocks.requireOrganizationSearch).toHaveBeenCalledExactlyOnceWith('org-canonical')
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('authorizes every canonical knowledge base before billing and search', async () => {
    const result = await searchKnowledge.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
      },
    })

    expect(mocks.resolvePermission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolveBilling.mock.invocationCallOrder[0]
    )
    expect(mocks.resolveBilling.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.executeSearch.mock.invocationCallOrder[0]
    )
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
    expect(mocks.searched).toHaveBeenCalledWith(
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('attributes workspace-key searches to the key scope without identifying the payer as the reader', async () => {
    await searchKnowledge.execute({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
      },
    })
    expect(mocks.searched).toHaveBeenCalledWith(
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          signal: AbortSignal.abort(new Error('Cancelled fixture search')),
        },
      })
    ).rejects.toThrow('Cancelled fixture search')
    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('forwards cancellation to providers and does not disguise a cancelled rerank as a fallback', async () => {
    const controller = new AbortController()
    mocks.rerank.mockImplementationOnce(async (_query, _items, options) => {
      expect(options.signal).toBe(controller.signal)
      controller.abort(new Error('Cancelled fixture rerank'))
      throw controller.signal.reason
    })
    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
          signal: controller.signal,
        },
      })
    ).rejects.toThrow('Cancelled fixture rerank')
    expect(mocks.generateEmbedding).toHaveBeenCalledWith(
      'answer',
      { model: knowledgeBase.embeddingModel, dimensions: knowledgeBase.embeddingDimension },
      'workspace-1',
      controller.signal
    )
    expect(mocks.searched).not.toHaveBeenCalled()
  })

  it('does not begin retrieval when cancellation races with a completed embedding', async () => {
    const controller = new AbortController()
    mocks.generateEmbedding.mockImplementationOnce(async () => {
      controller.abort(new Error('Search superseded during embedding'))
      return { embedding: [0.1], isBYOK: true }
    })
    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          signal: controller.signal,
        },
      })
    ).rejects.toThrow('Search superseded during embedding')
    expect(mocks.executeSearch).not.toHaveBeenCalled()
    expect(mocks.getDocumentMetadata).not.toHaveBeenCalled()
  })

  it('does not start reranking or metadata reads after retrieval is cancelled', async () => {
    const controller = new AbortController()
    mocks.executeSearch.mockImplementationOnce(async () => {
      controller.abort(new Error('Search superseded during retrieval'))
      return []
    })
    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
          signal: controller.signal,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
        },
      })
    ).rejects.toThrow('Search superseded during retrieval')
    expect(mocks.rerank).not.toHaveBeenCalled()
    expect(mocks.getDocumentMetadata).not.toHaveBeenCalled()
    expect(mocks.searched).not.toHaveBeenCalled()
  })

  it('records all searched bases and deduplicated returned documents for personal keys', async () => {
    mocks.getKnowledgeBase.mockImplementation(async (id: string) => ({ ...knowledgeBase, id }))
    mocks.executeSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        documentId: 'document-1',
        knowledgeBaseId: 'knowledge-1',
        content: 'first',
        chunkIndex: 0,
        distance: 0.1,
      },
      {
        id: 'chunk-2',
        documentId: 'document-1',
        knowledgeBaseId: 'knowledge-1',
        content: 'second',
        chunkIndex: 1,
        distance: 0.2,
      },
      {
        id: 'chunk-3',
        documentId: 'document-2',
        knowledgeBaseId: 'knowledge-2',
        content: 'third',
        chunkIndex: 0,
        distance: 0.3,
      },
    ])
    mocks.getDocumentMetadata.mockResolvedValue({
      'document-1': { filename: 'thread', connectorType: 'slack' },
      'document-2': { filename: 'page', connectorType: 'gitlab' },
    })
    await searchKnowledge.execute({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        query: 'answer',
        topK: 5,
        surface: 'mcp',
      },
    })
    expect(mocks.searched).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
        documentIds: ['document-1', 'document-2'],
        connectorTypes: ['slack', 'gitlab'],
        resultsCount: 3,
        actorUserId: 'user-1',
        principalKind: 'personal_api_key',
        surface: 'mcp',
      })
    )
  })

  it('lets the owner search a legacy personal knowledge base with account billing', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      ...knowledgeBase,
      workspaceId: null,
    })
    mocks.generateEmbedding.mockResolvedValueOnce({ embedding: [0.1], isBYOK: true })

    const result = await searchKnowledge.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
      },
    })

    expect(result.workspaceId).toBeUndefined()
    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.resolveBilling).not.toHaveBeenCalled()
    expect(mocks.checkActorUsage).toHaveBeenCalledWith('user-1')
    expect(mocks.executeSearch).toHaveBeenCalled()
  })

  it('conceals a legacy personal knowledge base from a non-owner', async () => {
    mocks.getKnowledgeBase.mockResolvedValueOnce({
      ...knowledgeBase,
      workspaceId: null,
    })

    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'other-user', sessionId: 'session-2' },
        input: {
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.checkActorUsage).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('enforces semantic knowledge-base and result bounds for trusted callers', async () => {
    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 101,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkspace).not.toHaveBeenCalled()
    expect(mocks.getKnowledgeBase).not.toHaveBeenCalled()
  })

  it('rejects multi-knowledge-base tag filters without embedding spend', async () => {
    mocks.getKnowledgeBase
      .mockResolvedValueOnce(knowledgeBase)
      .mockResolvedValueOnce({ ...knowledgeBase, id: 'knowledge-2' })

    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1', 'knowledge-2'],
          topK: 5,
          tagFilters: [{ tagName: 'team', operator: 'eq', value: 'docs' }],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.generateEmbedding).not.toHaveBeenCalled()
    expect(mocks.executeSearch).not.toHaveBeenCalled()
  })

  it('verifies trusted result provenance inside the authorized use case', async () => {
    const registry = { markIncomplete: vi.fn() }
    await searchKnowledge.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
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

  /**
   * The provenance snapshot vouches for the name, URL, and tags; the source
   * card's modified time and connector type only come from the access-filtered
   * metadata read, which a provenance-bearing search must therefore still make.
   */
  it('keeps the source card metadata when a provenance registry is present', async () => {
    const registry = { markIncomplete: vi.fn() }
    const sourceModifiedAt = new Date('2026-08-20T12:00:00Z')
    mocks.getDocumentMetadata.mockResolvedValueOnce({
      'document-1': {
        filename: 'guide.pdf',
        sourceUrl: 'https://example.com/guide',
        sourceModifiedAt,
        connectorType: 'google_drive',
      },
    })

    const result = await searchKnowledge.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        workspaceId: 'workspace-1',
        knowledgeBaseIds: ['knowledge-1'],
        query: 'answer',
        topK: 5,
        resultSecretRegistry: registry as never,
      },
    })

    expect(mocks.getDocumentMetadata).toHaveBeenCalledWith(['document-1'], expect.anything())
    expect(result.results[0]).toMatchObject({
      documentName: 'guide.pdf',
      sourceUrl: 'https://example.com/guide',
      sourceModifiedAt,
      connectorType: 'google_drive',
    })
  })

  describe('reranker outcome reporting', () => {
    const rerankedSearch = (rerankerEnabled?: boolean, query: string | undefined = 'answer') =>
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          ...(query === undefined ? {} : { query }),
          topK: 5,
          ...(rerankerEnabled === undefined ? {} : { rerankerEnabled }),
          rerankerModel: 'rerank-v4.0-pro' as const,
        },
      })

    it('reports applied when the reranker ordered the results', async () => {
      mocks.rerank.mockResolvedValueOnce({
        results: [{ item: { id: 'embedding-1' }, relevanceScore: 0.93 }],
        isBYOK: false,
      })

      const result = await rerankedSearch(true)

      expect(result.rerankerStatus).toBe('applied')
      expect(result.results[0]).toMatchObject({ rerankerScore: 0.93 })
    })

    /**
     * The reproduced defect: a deployment with no Cohere credential threw inside
     * `rerank`, the use case swallowed it, and the caller got a 200 whose results
     * were byte-identical to an unreranked search with nothing to distinguish them.
     */
    it('reports unavailable rather than silently falling back to vector ordering', async () => {
      mocks.rerank.mockRejectedValueOnce(new Error('No Cohere API key configured.'))

      const result = await rerankedSearch(true)

      expect(result.rerankerStatus).toBe('unavailable')
      expect(result.results[0]).not.toHaveProperty('rerankerScore')
    })

    /**
     * A resolved call with an empty ordering leaves the caller in the same place a
     * thrown one does — vector order, no `rerankerScore` — so it reports the same
     * status. It is not "the reranker matched nothing": `rerank` sends a non-empty
     * document list and asks for `top_n` of it, so an empty array means the
     * response carried nothing usable rather than a legitimate empty ranking.
     */
    it('reports unavailable when the call resolves without a usable ordering', async () => {
      mocks.rerank.mockResolvedValueOnce({ results: [], isBYOK: false })

      const result = await rerankedSearch(true)

      expect(result.rerankerStatus).toBe('unavailable')
      expect(result.results[0]).not.toHaveProperty('rerankerScore')
    })

    it('reports skipped for a tag-only search, which has no query to rank against', async () => {
      mocks.getTagDefinitions.mockResolvedValue([
        { tagSlot: 'tag1', displayName: 'team', fieldType: 'text' },
      ])

      const result = await searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          topK: 5,
          tagFilters: [{ tagName: 'team', operator: 'eq', value: 'docs' }],
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-pro' as const,
        },
      })

      expect(result.rerankerStatus).toBe('skipped')
      expect(mocks.rerank).not.toHaveBeenCalled()
    })

    it('reports not_requested when the caller did not ask for reranking', async () => {
      const result = await rerankedSearch(undefined)

      expect(result.rerankerStatus).toBe('not_requested')
      expect(mocks.rerank).not.toHaveBeenCalled()
    })
  })

  it('propagates tag-definition infrastructure failures', async () => {
    const failure = new Error('tag database unavailable')
    mocks.getTagDefinitions.mockRejectedValueOnce(failure)

    await expect(
      searchKnowledge.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          query: 'answer',
          topK: 5,
        },
      })
    ).rejects.toBe(failure)
  })
})
