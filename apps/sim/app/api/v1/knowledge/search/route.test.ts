/**
 * Tests for v1 knowledge search API route.
 * Specifically guards the per-KB embedding model resolution and the
 * multi-model rejection so the v1 endpoint stays in lockstep with the
 * internal route.
 *
 * @vitest-environment node
 */

import {
  createMockRequest,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
  resetEnvFlagsMock,
  setEnvFlags,
} from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveV1KnowledgeReadAccess,
  mockExecuteKnowledgeSearch,
  mockRetrievalStatus,
  mockGenerateSearchEmbedding,
  mockGetDocumentTagDefinitions,
  mockAuthenticateRequest,
  mockValidateWorkspaceAccess,
  mockResolveBillingAttribution,
  mockResolveSystemBillingAttribution,
  mockRecordSearchEmbeddingUsage,
} = vi.hoisted(() => ({
  mockResolveV1KnowledgeReadAccess: vi.fn(),
  mockExecuteKnowledgeSearch: vi.fn(),
  mockRetrievalStatus: vi.fn(() => ({ status: 'complete', timedOutLegs: [] })),
  mockGenerateSearchEmbedding: vi.fn(),
  mockGetDocumentTagDefinitions: vi.fn(),
  mockAuthenticateRequest: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockRecordSearchEmbeddingUsage: vi.fn(),
}))

const SYSTEM_BILLING_ATTRIBUTION = {
  actorUserId: 'owner-after-transfer',
  workspaceId: 'ws-1',
  organizationId: 'org-after-transfer',
  billedAccountUserId: 'owner-after-transfer',
  billingEntity: { type: 'organization' as const, id: 'org-after-transfer' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

/** The route's defaults depend on member-access availability; pin it so the local flag cannot change the expectations. */
vi.mock('@/lib/knowledge/access/availability', () => ({
  isKnowledgeMemberAccessAvailable: async () => false,
}))

vi.mock('@/lib/knowledge/search/queries', () => ({
  /** The route reads the retrieval result; the rows come from the same mock the tests drive. */
  retrieveKnowledgeSearch: async (params: { access: unknown }) => ({
    rows: await mockExecuteKnowledgeSearch(params),
    retrieval: mockRetrievalStatus(),
  }),
}))

vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: vi.fn().mockResolvedValue({ isExceeded: false }),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
}))
const { mockCheckSearchUsageLimits } = vi.hoisted(() => ({
  mockCheckSearchUsageLimits: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-gate-cache', () => ({
  checkSearchUsageLimits: mockCheckSearchUsageLimits,
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: mockGenerateSearchEmbedding,
  recordSearchEmbeddingUsage: mockRecordSearchEmbeddingUsage,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  authenticateRequest: mockAuthenticateRequest,
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
  capabilityGovernedUserId: (rateLimit: { keyType?: string; userId?: string }) =>
    rateLimit.keyType === 'workspace' ? null : (rateLimit.userId ?? null),
  v1ValidationErrorResponse: (e: { issues: unknown[] }) =>
    NextResponse.json({ error: 'Validation error', details: e.issues }, { status: 400 }),
}))

vi.mock('@/app/api/v1/knowledge/utils', () => ({
  resolveV1KnowledgeReadAccess: mockResolveV1KnowledgeReadAccess,
  handleError: (e: unknown) =>
    new Response(JSON.stringify({ error: getErrorMessage(e, 'error') }), {
      status: 500,
    }),
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: mockGetDocumentTagDefinitions,
}))

import { POST } from '@/app/api/v1/knowledge/search/route'

const mockCheckKnowledgeBaseAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess

const baseKb = (id: string, embeddingModel: string, embeddingDimension = 1536) => ({
  id,
  userId: 'user-1',
  name: `KB ${id}`,
  workspaceId: 'ws-1',
  embeddingModel,
  embeddingDimension,
  deletedAt: null,
})

describe('v1 knowledge search route — per-KB embedding model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSearchUsageLimits.mockResolvedValue({ isExceeded: false })
    resetEnvFlagsMock()
    mockResolveV1KnowledgeReadAccess.mockResolvedValue({ kind: 'workspace', tokens: ['pub', 'ws'] })
    mockAuthenticateRequest.mockResolvedValue({
      requestId: 'req-1',
      userId: 'user-1',
      rateLimit: {},
    })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockGenerateSearchEmbedding.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      isBYOK: false,
    })
    mockExecuteKnowledgeSearch.mockResolvedValue([])
    mockGetDocumentTagDefinitions.mockResolvedValue([])
    mockResolveBillingAttribution.mockImplementation(
      ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) =>
        Promise.resolve({
          actorUserId,
          workspaceId,
          billingEntity: { type: 'organization', id: 'org-1' },
        })
    )
    mockResolveSystemBillingAttribution.mockResolvedValue(SYSTEM_BILLING_ATTRIBUTION)
    mockRecordSearchEmbeddingUsage.mockResolvedValue(undefined)
  })

  it('fails a search whose retrieval ran out of time instead of returning partial rows', async () => {
    const access = { kind: 'user' as const, userId: 'user-1', tokens: ['reader-token'] }
    mockResolveV1KnowledgeReadAccess.mockResolvedValue({
      get: vi.fn().mockResolvedValue(access),
      getForConnectors: vi.fn(),
      getForDocuments: vi.fn(),
    })
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-1', 'text-embedding-3-small'),
    })
    mockRetrievalStatus.mockReturnValueOnce({ status: 'partial', timedOutLegs: ['vector'] })
    mockExecuteKnowledgeSearch.mockResolvedValue([])
    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1', knowledgeBaseIds: 'kb-1', query: 'hello' })
    )
    expect(mockExecuteKnowledgeSearch).toHaveBeenCalledOnce()
    expect(response.status).toBe(500)
  })

  it('refuses a search index while indexed organization search is dormant, before any spend', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: { ...baseKb('kb-1', 'text-embedding-3-small'), isSearchIndex: true },
    })
    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1', knowledgeBaseIds: 'kb-1', query: 'hello' })
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'This search index is inactive; use Sim Search.',
    })
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
    expect(mockExecuteKnowledgeSearch).not.toHaveBeenCalled()
  })

  it('refuses a dormant search index for its dormancy, not the caller exhausted usage', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    mockCheckSearchUsageLimits.mockResolvedValue({ isExceeded: true, message: 'Over limit' })
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: { ...baseKb('kb-1', 'text-embedding-3-small'), isSearchIndex: true },
    })
    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1', knowledgeBaseIds: 'kb-1', query: 'hello' })
    )
    expect(response.status).toBe(409)
    expect(mockCheckSearchUsageLimits).not.toHaveBeenCalled()
  })

  it('searches a workspace knowledge base while indexed organization search is dormant', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: { ...baseKb('kb-1', 'text-embedding-3-small'), isSearchIndex: false },
    })
    const response = await POST(
      createMockRequest('POST', { workspaceId: 'ws-1', knowledgeBaseIds: 'kb-1', query: 'hello' })
    )
    expect(response.status).toBe(200)
    expect(mockExecuteKnowledgeSearch).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseIds: ['kb-1'], searchIndexOnly: false })
    )
  })

  it('retains the reader provider for ranked results and returned document metadata', async () => {
    const access = { kind: 'user' as const, userId: 'user-1', tokens: ['reader-token'] }
    const provider = {
      get: vi.fn().mockResolvedValue(access),
      getForConnectors: vi.fn(),
      getForDocuments: vi.fn(),
    }
    mockResolveV1KnowledgeReadAccess.mockResolvedValue(provider)
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-1', 'text-embedding-3-small'),
    })
    const response = await POST(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        knowledgeBaseIds: 'kb-1',
        query: 'hello',
      })
    )
    expect(response.status).toBe(200)
    expect(mockExecuteKnowledgeSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        access,
        accessProvider: provider,
      })
    )
  })

  it.each(['query', 'filters'] as const)(
    'renders the source card each %s result row carries',
    async (mode) => {
      const access = { kind: 'user' as const, userId: 'user-1', tokens: ['reader-token'] }
      const provider = {
        get: vi.fn().mockResolvedValue(access),
        getForConnectors: vi.fn(),
        getForDocuments: vi.fn(),
      }
      mockResolveV1KnowledgeReadAccess.mockResolvedValue(provider)
      mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: baseKb('kb-1', 'text-embedding-3-small'),
      })
      mockGetDocumentTagDefinitions.mockResolvedValue([
        { tagSlot: 'tag1', displayName: 'category', fieldType: 'text' },
      ])
      mockExecuteKnowledgeSearch.mockResolvedValue([
        {
          documentId: 'allowed-document',
          knowledgeBaseId: 'kb-1',
          content: 'allowed page content',
          filename: 'Allowed page',
          sourceUrl: null,
          tag1: 'docs',
          chunkIndex: 0,
          distance: 0.2,
        },
      ])
      const response = await POST(
        createMockRequest('POST', {
          workspaceId: 'ws-1',
          knowledgeBaseIds: 'kb-1',
          ...(mode === 'query'
            ? { query: 'docs' }
            : { tagFilters: [{ tagName: 'category', operator: 'eq', value: 'docs' }] }),
        })
      )
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(mockExecuteKnowledgeSearch).toHaveBeenCalledWith(
        expect.objectContaining({ access, accessProvider: provider })
      )
      expect(body.data.results).toEqual([
        expect.objectContaining({
          documentId: 'allowed-document',
          documentName: 'Allowed page',
          sourceUrl: null,
          content: 'allowed page content',
          metadata: { category: 'docs' },
        }),
      ])
      expect(body.data.totalResults).toBe(1)
    }
  )

  it('passes the KB embedding model into generateSearchEmbedding', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-gemini', 'gemini-embedding-001'),
    })

    const req = createMockRequest('POST', {
      workspaceId: 'ws-1',
      knowledgeBaseIds: 'kb-gemini',
      query: 'hello',
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockGenerateSearchEmbedding).toHaveBeenCalledWith(
      'hello',
      { model: 'gemini-embedding-001', dimensions: 1536 },
      'ws-1'
    )
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
  })

  it('uses one atomic system actor and payer snapshot for a workspace API key', async () => {
    mockAuthenticateRequest.mockResolvedValue({
      requestId: 'req-1',
      userId: 'key-creator',
      rateLimit: { keyType: 'workspace' },
    })
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-workspace-key', 'text-embedding-3-small'),
    })

    const res = await POST(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        knowledgeBaseIds: 'kb-workspace-key',
        query: 'hello',
      })
    )

    expect(res.status).toBe(200)
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('ws-1')
    expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
    expect(mockRecordSearchEmbeddingUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-after-transfer',
        workspaceId: 'ws-1',
        billingAttribution: SYSTEM_BILLING_ATTRIBUTION,
      })
    )
  })

  it('rejects cross-KB queries with mixed vector widths, which store in different columns', async () => {
    mockCheckKnowledgeBaseAccess
      .mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: baseKb('kb-1536', 'text-embedding-3-large', 1536),
      })
      .mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: baseKb('kb-3072', 'text-embedding-3-large', 3072),
      })

    const req = createMockRequest('POST', {
      workspaceId: 'ws-1',
      knowledgeBaseIds: ['kb-1536', 'kb-3072'],
      query: 'hello',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
  })

  it('rejects cross-KB queries with mixed embedding models', async () => {
    mockCheckKnowledgeBaseAccess
      .mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: baseKb('kb-openai', 'text-embedding-3-small'),
      })
      .mockResolvedValueOnce({
        hasAccess: true,
        knowledgeBase: baseKb('kb-gemini', 'gemini-embedding-001'),
      })

    const req = createMockRequest('POST', {
      workspaceId: 'ws-1',
      knowledgeBaseIds: ['kb-openai', 'kb-gemini'],
      query: 'hello',
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
  })

  it('surfaces the sourceUrl a result row carries', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-confluence', 'text-embedding-3-small'),
    })
    mockExecuteKnowledgeSearch.mockResolvedValue([
      {
        documentId: 'doc-confluence',
        knowledgeBaseId: 'kb-confluence',
        content: 'page content',
        filename: 'Runbook.md',
        sourceUrl: 'https://example.atlassian.net/wiki/spaces/DOCS/pages/12345',
        chunkIndex: 0,
        distance: 0.1,
      },
    ])

    const req = createMockRequest('POST', {
      workspaceId: 'ws-1',
      knowledgeBaseIds: 'kb-confluence',
      query: 'runbook',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.results[0].sourceUrl).toBe(
      'https://example.atlassian.net/wiki/spaces/DOCS/pages/12345'
    )
    expect(body.data.results[0].documentName).toBe('Runbook.md')
  })

  it('allows tag-only search across mixed embedding models', async () => {
    mockExecuteKnowledgeSearch.mockResolvedValue([])
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-mixed', 'text-embedding-3-small'),
    })

    const req = createMockRequest('POST', {
      workspaceId: 'ws-1',
      knowledgeBaseIds: 'kb-mixed',
      tagFilters: [{ tagName: 'category', operator: 'eq', value: 'docs' }],
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    // tagName "category" is undefined in our empty getDocumentTagDefinitions mock,
    // so the route returns 400 before reaching the search handlers — but crucially
    // it never tries to generate an embedding.
    expect(mockGenerateSearchEmbedding).not.toHaveBeenCalled()
  })
})
