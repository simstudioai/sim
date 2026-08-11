/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
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
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { operation: { id: 'knowledge.search' }, execute: mockSearch },
}))

import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
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
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rolloutUserId: 'billing-owner',
      rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`],
      rateLimitSubscription: null,
      keyType: 'workspace',
    })
    mockSearch.mockResolvedValue({
      results: [
        {
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
      topK: 10,
      totalResults: 1,
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
        workspaceId: WORKSPACE_ID,
        knowledgeBaseIds: ['kb-1'],
        query: 'hello',
        topK: 10,
        tagFilters: undefined,
        searchMode: 'hybrid',
      },
      request,
    })
    expect(await response.json()).toEqual({
      data: expect.objectContaining({ knowledgeBaseIds: ['kb-1'], totalResults: 1 }),
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
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
