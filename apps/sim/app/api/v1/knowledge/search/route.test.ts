/**
 * Tests for v1 knowledge search API route.
 * Specifically guards the per-KB embedding model resolution and the
 * multi-model rejection so the v1 endpoint stays in lockstep with the
 * internal route.
 */

import { createMockRequest, knowledgeApiUtilsMock, knowledgeApiUtilsMockFns } from '@sim/testing'
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
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeTagsServiceMock,
  knowledgeTagsServiceMockFns,
} from '@sim/testing/mocks/knowledge-tags-service.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveV1KnowledgeReadAccess, mockExecuteKnowledgeSearch, mockRetrievalStatus } =
  vi.hoisted(() => ({
    mockResolveV1KnowledgeReadAccess: vi.fn(),
    mockExecuteKnowledgeSearch: vi.fn(),
    mockRetrievalStatus: vi.fn(() => ({ status: 'complete', timedOutLegs: [] })),
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

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

vi.mock('@/lib/knowledge/search/queries', () => ({
  /** The route reads the retrieval result; the rows come from the same mock the tests drive. */
  retrieveKnowledgeSearch: async (params: { access: unknown }) => ({
    rows: await mockExecuteKnowledgeSearch(params),
    retrieval: mockRetrievalStatus(),
  }),
}))

vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)

vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)
vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/app/api/v1/knowledge/utils', () => ({
  resolveV1KnowledgeReadAccess: mockResolveV1KnowledgeReadAccess,
  handleError: (e: unknown) =>
    new Response(JSON.stringify({ error: getErrorMessage(e, 'error') }), {
      status: 500,
    }),
}))

vi.mock('@/lib/knowledge/tags/service', () => knowledgeTagsServiceMock)

import { POST } from '@/app/api/v1/knowledge/search/route'

const { mockGetDocumentTagDefinitions } = knowledgeTagsServiceMockFns
const { mockGenerateSearchEmbedding, mockRecordSearchEmbeddingUsage } = knowledgeEmbeddingsMockFns

billingUsageGateCacheMockFns.mockCheckSearchUsageLimits.mockResolvedValue({ isExceeded: false })

billingUsageMonitorMockFns.mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
const { mockAuthenticateRequest, mockValidateWorkspaceAccess } = v1MiddlewareMockFns
v1MiddlewareMockFns.mockCapabilityGovernedUserId.mockImplementation(
  (rateLimit: { keyType?: string; userId?: string }) =>
    rateLimit.keyType === 'workspace' ? null : (rateLimit.userId ?? null)
)

const mockCheckKnowledgeBaseAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess
const { mockResolveBillingAttribution, mockResolveSystemBillingAttribution } =
  billingAttributionMockFns

/** The route's defaults depend on member-access availability; pin it so the local flag cannot change the expectations. */
knowledgeAvailabilityMockFns.mockIsKnowledgeMemberAccessAvailable.mockResolvedValue(false)

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
})
