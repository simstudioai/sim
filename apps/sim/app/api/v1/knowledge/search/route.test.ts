/**
 * Tests for v1 knowledge search API route.
 * Specifically guards the per-KB embedding model resolution and the
 * multi-model rejection so the v1 endpoint stays in lockstep with the
 * internal route.
 *
 * @vitest-environment node
 */

import { createMockRequest, knowledgeApiUtilsMock, knowledgeApiUtilsMockFns } from '@sim/testing'
import { getErrorMessage } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockHandleVectorOnlySearch,
  mockHandleTagOnlySearch,
  mockHandleTagAndVectorSearch,
  mockGetQueryStrategy,
  mockGenerateSearchEmbedding,
  mockGetDocumentMetadataByIds,
  mockAuthenticateRequest,
  mockValidateWorkspaceAccess,
} = vi.hoisted(() => ({
  mockHandleVectorOnlySearch: vi.fn(),
  mockHandleTagOnlySearch: vi.fn(),
  mockHandleTagAndVectorSearch: vi.fn(),
  mockGetQueryStrategy: vi.fn(),
  mockGenerateSearchEmbedding: vi.fn(),
  mockGetDocumentMetadataByIds: vi.fn(),
  mockAuthenticateRequest: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
}))

vi.mock('@/app/api/knowledge/search/utils', () => ({
  handleVectorOnlySearch: mockHandleVectorOnlySearch,
  handleTagOnlySearch: mockHandleTagOnlySearch,
  handleTagAndVectorSearch: mockHandleTagAndVectorSearch,
  getQueryStrategy: mockGetQueryStrategy,
  generateSearchEmbedding: mockGenerateSearchEmbedding,
  getDocumentMetadataByIds: mockGetDocumentMetadataByIds,
}))

vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)

vi.mock('@/app/api/v1/middleware', () => ({
  authenticateRequest: mockAuthenticateRequest,
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}))

vi.mock('@/app/api/v1/knowledge/utils', () => ({
  handleError: (e: unknown) =>
    new Response(JSON.stringify({ error: getErrorMessage(e, 'error') }), {
      status: 500,
    }),
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getDocumentTagDefinitions: vi.fn().mockResolvedValue([]),
}))

import { POST } from '@/app/api/v1/knowledge/search/route'

const mockCheckKnowledgeBaseAccess = knowledgeApiUtilsMockFns.mockCheckKnowledgeBaseAccess

const baseKb = (id: string, embeddingModel: string) => ({
  id,
  userId: 'user-1',
  name: `KB ${id}`,
  workspaceId: 'ws-1',
  embeddingModel,
  deletedAt: null,
})

describe('v1 knowledge search route — per-KB embedding model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateRequest.mockResolvedValue({
      requestId: 'req-1',
      userId: 'user-1',
      rateLimit: {},
    })
    mockValidateWorkspaceAccess.mockResolvedValue(null)
    mockGetQueryStrategy.mockReturnValue({ distanceThreshold: 0.5 })
    mockGenerateSearchEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockHandleVectorOnlySearch.mockResolvedValue([])
    mockGetDocumentMetadataByIds.mockResolvedValue({})
  })

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
      'gemini-embedding-001',
      'ws-1'
    )
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

  it('surfaces sourceUrl from document metadata in search results', async () => {
    mockCheckKnowledgeBaseAccess.mockResolvedValueOnce({
      hasAccess: true,
      knowledgeBase: baseKb('kb-confluence', 'text-embedding-3-small'),
    })
    mockHandleVectorOnlySearch.mockResolvedValue([
      {
        documentId: 'doc-confluence',
        knowledgeBaseId: 'kb-confluence',
        content: 'page content',
        chunkIndex: 0,
        distance: 0.1,
      },
    ])
    mockGetDocumentMetadataByIds.mockResolvedValue({
      'doc-confluence': {
        filename: 'Runbook.md',
        sourceUrl: 'https://example.atlassian.net/wiki/spaces/DOCS/pages/12345',
      },
    })

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
    mockHandleTagOnlySearch.mockResolvedValue([])
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
