/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { operation: { id: 'knowledge.search' }, execute: mockSearch },
}))

import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { DEFAULT_RERANKER_MODEL } from '@/lib/knowledge/reranker-models'
import { POST, V2_KNOWLEDGE_SEARCH_MAX_BODY_BYTES } from '@/app/api/v2/knowledge/search/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' } as const
function buildRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v2/knowledge/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret', ...headers },
    body,
  })
}

describe('POST /api/v2/knowledge/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    mockSearch.mockResolvedValue({
      results: [
        {
          embeddingId: 'embedding-1',
          knowledgeBaseId: 'kb-1',
          documentId: 'doc-1',
          documentName: 'support.txt',
          sourceUrl: null,
          content: 'hello',
          chunkIndex: 0,
          metadata: { category: 'billing' },
          similarity: 0.9,
          rerankerScore: 0.42,
        },
      ],
      query: 'hello',
      knowledgeBaseIds: ['kb-1'],
      topK: 10,
      totalResults: 1,
      rerankerStatus: 'applied',
    })
  })

  it('delegates normalized IDs and the selected search mode through the semantic operation', async () => {
    const request = buildRequest(
      JSON.stringify({
        workspaceId: WORKSPACE_ID,
        knowledgeBaseIds: 'kb-1',
        query: 'hello',
        topK: 10,
        searchMode: 'hybrid',
      })
    )

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith({
      principal: PRINCIPAL,
      input: {
        surface: 'api',
        workspaceId: WORKSPACE_ID,
        knowledgeBaseIds: ['kb-1'],
        query: 'hello',
        topK: 10,
        tagFilters: undefined,
        searchMode: 'hybrid',
        rerankerEnabled: undefined,
        rerankerModel: DEFAULT_RERANKER_MODEL,
        rerankerInputCount: undefined,
      },
      request,
    })
    expect(await response.json()).toEqual({
      data: expect.objectContaining({ knowledgeBaseIds: ['kb-1'], totalResults: 1 }),
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('names the source knowledge base and the reranker score on every result', async () => {
    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1', 'kb-2'],
          query: 'hello',
          topK: 10,
        })
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.results[0]).toEqual({
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-1',
      documentName: 'support.txt',
      sourceUrl: null,
      content: 'hello',
      chunkIndex: 0,
      metadata: { category: 'billing' },
      similarity: 0.9,
      rerankerScore: 0.42,
    })
  })

  it('forwards reranker options and never a caller-supplied reranker key', async () => {
    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
          rerankerInputCount: 40,
        })
      )
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
          rerankerInputCount: 40,
        }),
      })
    )
    const [{ input }] = mockSearch.mock.calls[0]
    expect(input).not.toHaveProperty('rerankerApiKey')
    expect(input).not.toHaveProperty('skipUsageBilling')
  })

  /**
   * Without the default, `rerankerEnabled` alone satisfies the schema, fails the
   * use case's model guard, and answers 200 in plain vector order — after paying
   * for the widened candidate retrieval.
   */
  it('defaults the reranker model so enabling reranking is enough to run it', async () => {
    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
        })
      )
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          rerankerEnabled: true,
          rerankerModel: DEFAULT_RERANKER_MODEL,
        }),
      })
    )
  })

  it('reports on the wire that a requested reranker did not run', async () => {
    mockSearch.mockResolvedValueOnce({
      results: [
        {
          embeddingId: 'embedding-1',
          knowledgeBaseId: 'kb-1',
          documentId: 'doc-1',
          documentName: 'support.txt',
          sourceUrl: null,
          content: 'hello',
          chunkIndex: 0,
          metadata: {},
          similarity: 0.9,
        },
      ],
      query: 'hello',
      knowledgeBaseIds: ['kb-1'],
      topK: 5,
      totalResults: 1,
      rerankerStatus: 'unavailable',
    })

    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-pro',
        })
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.rerankerStatus).toBe('unavailable')
    expect(body.data.results[0]).not.toHaveProperty('rerankerScore')
  })

  it('rejects an unsupported reranker model and an out-of-range candidate pool', async () => {
    const unsupportedModel = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-does-not-exist',
        })
      )
    )
    const oversizedPool = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
          rerankerInputCount: 101,
        })
      )
    )

    expect(unsupportedModel.status).toBe(400)
    expect(oversizedPool.status).toBe(400)
    expect(await oversizedPool.json()).toEqual({
      error: expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('rerankerInputCount cannot exceed 100'),
      }),
    })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  /**
   * The search body is strict, so an undeclared key is refused rather than
   * stripped. That matters most for a bring-your-own reranker key: dropping it
   * silently left the caller believing the secret it sent was in use. It
   * matters for an ordinary mis-spelling too: a stripped `rerankerenabled` is a
   * 200 with reranking off, and a stripped `topk` leaves `topK` at its default —
   * both change what the search is billed.
   */
  it('refuses a caller-supplied reranker key instead of silently dropping it', async () => {
    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 5,
          rerankerEnabled: true,
          rerankerModel: 'rerank-v4.0-fast',
          rerankerApiKey: 'secret-byok-key',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('forwards an opted-in hybrid search mode to the application use case', async () => {
    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 10,
          searchMode: 'hybrid',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ searchMode: 'hybrid' }),
      })
    )
  })

  it('authenticates before rejecting malformed JSON', async () => {
    const response = await POST(buildRequest('{'))

    expect(response.status).toBe(400)
    expect(v2RouteMocks.authenticate).toHaveBeenCalledOnce()
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('maps usage failures without exposing infrastructure details', async () => {
    mockSearch.mockRejectedValue(new KnowledgeUsageLimitExceededError('Upgrade required'))

    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 10,
        })
      )
    )

    expect(response.status).toBe(402)
    expect(await response.json()).toEqual({
      error: { code: 'USAGE_LIMIT_EXCEEDED', message: 'Upgrade required' },
    })
  })

  it('rejects a body over the internal-parity cap before application execution', async () => {
    const response = await POST(
      buildRequest('{}', { 'content-length': String(V2_KNOWLEDGE_SEARCH_MAX_BODY_BYTES + 1) })
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    })
    expect(mockSearch).not.toHaveBeenCalled()
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('does not expose application infrastructure failures', async () => {
    mockSearch.mockRejectedValueOnce(new Error('database host is private-db'))

    const response = await POST(
      buildRequest(
        JSON.stringify({
          workspaceId: WORKSPACE_ID,
          knowledgeBaseIds: ['kb-1'],
          query: 'hello',
          topK: 10,
        })
      )
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
