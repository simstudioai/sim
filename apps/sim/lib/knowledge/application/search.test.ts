/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
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
  getWorkspaceKnowledgeBases: vi.fn(),
  loadActiveFolderPathIndex: vi.fn(),
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

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mocks.checkActorUsage,
}))

vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeWorkspaceContext: mocks.resolveWorkspace,
}))

/*
 * Folder expansion reads through this same module, so the factory has to name
 * `getWorkspaceKnowledgeBases` too — a factory listing only what today's tests
 * touch leaves a new code path undefined and unreachable by any test.
 */
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: mocks.getKnowledgeBase,
  getWorkspaceKnowledgeBases: mocks.getWorkspaceKnowledgeBases,
}))

vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: mocks.loadActiveFolderPathIndex,
  resolveFolderPathFilter: (index: { pathById: Map<string, string> }, path?: string) => {
    if (path === undefined) return { kind: 'unfiltered' as const }
    if (path === '/') return { kind: 'folder' as const, folderId: null }
    for (const [folderId, folderPath] of index.pathById) {
      if (folderPath === path) return { kind: 'folder' as const, folderId }
    }
    return { kind: 'noMatch' as const }
  },
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
}

describe('knowledge search application use case', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      })
    )
    expect(result.results[0]).toMatchObject({
      embeddingId: 'embedding-1',
      documentId: 'document-1',
      similarity: 0.8,
    })
    expect(result.knowledgeBases).toEqual([{ id: 'knowledge-1', name: 'Docs' }])
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
  /*
   * A folder stands for the knowledge bases inside it, resolved at run time. The
   * expansion has to land on the SAME authorization path as an explicit list, so
   * these assert what reaches `executeKnowledgeSearch` and that permission is
   * still resolved first.
   */
  describe('folder scope', () => {
    const SESSION = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    function withFolders(paths: Record<string, string>) {
      mocks.loadActiveFolderPathIndex.mockResolvedValue({
        pathById: new Map(Object.entries(paths)),
        rowById: new Map(
          Object.keys(paths).map((id) => [
            id,
            { id, parentId: id === 'support' ? null : 'support' },
          ])
        ),
      })
    }

    beforeEach(() => {
      withFolders({ support: '/Support', tier1: '/Support/Tier1' })
      mocks.getWorkspaceKnowledgeBases.mockResolvedValue({ data: [knowledgeBase] })
    })

    it('searches the knowledge bases a folder expands to', async () => {
      const result = await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/Support',
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.getWorkspaceKnowledgeBases).toHaveBeenCalledWith('workspace-1', 'active', {
        folderId: 'support',
      })
      expect(mocks.executeSearch).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeBaseIds: ['knowledge-1'] })
      )
      expect(result.knowledgeBases).toEqual([{ id: 'knowledge-1', name: 'Docs' }])
    })

    it('reaches subfolders only when asked', async () => {
      await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/Support',
          folderIncludeSubfolders: true,
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.getWorkspaceKnowledgeBases).toHaveBeenCalledWith(
        'workspace-1',
        'active',
        expect.objectContaining({ folderIds: ['support', 'tier1'] })
      )
    })

    /*
     * A folder is a scope, so naming a knowledge base inside it is the narrower
     * answer. Unioning would make "this folder, specifically this one" search
     * more than either alone.
     */
    it('lets a named knowledge base win over the folder rather than adding to it', async () => {
      mocks.getWorkspaceKnowledgeBases.mockResolvedValue({
        data: [knowledgeBase, { ...knowledgeBase, id: 'knowledge-2' }],
      })

      await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: ['knowledge-1'],
          folderPath: '/Support',
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.executeSearch).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeBaseIds: ['knowledge-1'] })
      )
      /* The folder is not even expanded when the caller already named a target. */
      expect(mocks.getWorkspaceKnowledgeBases).not.toHaveBeenCalled()
    })

    /*
     * `resolveFolderPathFromIndex` reports the root as `null`, so a descending
     * root scope must NOT go through `folderIds`: `inArray` never matches a NULL
     * folder id, and every knowledge base sitting loose at the root would
     * silently drop out of a search that asked for everything.
     */
    it('reads a descending root scope as the whole workspace, not a folder-id list', async () => {
      await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/',
          folderIncludeSubfolders: true,
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.getWorkspaceKnowledgeBases).toHaveBeenCalledWith('workspace-1', 'active', {})
    })

    it('reads a non-descending root scope as the knowledge bases loose at the root', async () => {
      await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/',
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.getWorkspaceKnowledgeBases).toHaveBeenCalledWith('workspace-1', 'active', {
        folderId: null,
      })
    })

    it('does not re-read a knowledge base the folder expansion already loaded', async () => {
      await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/Support',
          query: 'answer',
          topK: 5,
        },
      })

      expect(mocks.getKnowledgeBase).not.toHaveBeenCalled()
    })

    /*
     * Empty is an answer, not a failure — but the permission check still has to
     * run, or pointing at an empty folder would be a way around it.
     */
    it('returns no results for an empty folder, having still authorized the read', async () => {
      mocks.getWorkspaceKnowledgeBases.mockResolvedValue({ data: [] })

      const result = await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/Support',
          query: 'answer',
          topK: 5,
        },
      })

      expect(result.results).toEqual([])
      expect(result.totalResults).toBe(0)
      expect(mocks.resolvePermission).toHaveBeenCalled()
      expect(mocks.executeSearch).not.toHaveBeenCalled()
      expect(mocks.generateEmbedding).not.toHaveBeenCalled()
    })

    it('treats a folder path that matches nothing as an empty folder', async () => {
      const result = await searchKnowledge.execute({
        principal: SESSION,
        input: {
          workspaceId: 'workspace-1',
          knowledgeBaseIds: [],
          folderPath: '/Nope',
          query: 'answer',
          topK: 5,
        },
      })

      expect(result.results).toEqual([])
      expect(mocks.getWorkspaceKnowledgeBases).not.toHaveBeenCalled()
    })

    it('refuses a folder scope whose expansion exceeds the search fan-out cap', async () => {
      mocks.getWorkspaceKnowledgeBases.mockResolvedValue({
        data: Array.from({ length: 21 }, (_, index) => ({
          ...knowledgeBase,
          id: `knowledge-${index}`,
        })),
      })

      await expect(
        searchKnowledge.execute({
          principal: SESSION,
          input: {
            workspaceId: 'workspace-1',
            knowledgeBaseIds: [],
            folderPath: '/Support',
            query: 'answer',
            topK: 5,
          },
        })
      ).rejects.toThrow('holds 21 knowledge bases; a search covers at most 20')
    })

    /**
     * The fan-out error names the folder and its knowledge-base count, so the
     * expansion must not run for a caller who cannot read the workspace —
     * otherwise a 400 becomes a probe. Authorization runs between
     * `resolveContext` and `execute`, so "did we read?" is the observable proof
     * that the expansion sits on the right side of it.
     */
    it('does not read the folder when the caller cannot access the workspace', async () => {
      mocks.resolvePermission.mockResolvedValue(null)

      await expect(
        searchKnowledge.execute({
          principal: SESSION,
          input: {
            workspaceId: 'workspace-1',
            knowledgeBaseIds: [],
            folderPath: '/Support',
            folderIncludeSubfolders: true,
            query: 'answer',
            topK: 5,
          },
        })
      ).rejects.toThrow()

      expect(mocks.getWorkspaceKnowledgeBases).not.toHaveBeenCalled()
      expect(mocks.loadActiveFolderPathIndex).not.toHaveBeenCalled()
    })

    /*
     * topK bounds the request, not the way its target was chosen. The folder
     * branch returns early, so without hoisting the check a fractional limit
     * would reach execution on a folder scope while failing on an equivalent
     * knowledge-base scope.
     */
    it('applies the topK bound to a folder scope too', async () => {
      await expect(
        searchKnowledge.execute({
          principal: SESSION,
          input: {
            workspaceId: 'workspace-1',
            knowledgeBaseIds: [],
            folderPath: '/Support',
            query: 'answer',
            topK: 5.5,
          },
        })
      ).rejects.toThrow('topK must be an integer')
    })

    it('refuses a folder scope with no workspace to resolve it against', async () => {
      await expect(
        searchKnowledge.execute({
          principal: SESSION,
          input: { knowledgeBaseIds: [], folderPath: '/Support', query: 'answer', topK: 5 },
        })
      ).rejects.toThrow('folder scope requires a workspace')
    })
  })
})
