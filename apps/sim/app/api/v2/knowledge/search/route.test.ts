/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthenticate, mockCheckPreAuth, mockCheckRateLimit, mockSearch } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockCheckPreAuth: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockSearch: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mockAuthenticate,
  V2ApiKeyUnauthenticatedError: class V2ApiKeyUnauthenticatedError extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 100, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect(...args: unknown[]) {
      return mockCheckPreAuth(...args)
    }

    checkRateLimitDirectOrThrow(...args: unknown[]) {
      return mockCheckRateLimit(...args)
    }
  },
}))

vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/knowledge/application/search', () => ({
  searchKnowledge: { operation: { id: 'knowledge.search' }, execute: mockSearch },
}))

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { POST } from '@/app/api/v2/knowledge/search/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'workspace_api_key', workspaceId: WORKSPACE_ID, keyId: 'key-1' } as const
const RATE_LIMIT_OK = {
  allowed: true,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
  retryAfterMs: 0,
}

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
    mockCheckPreAuth.mockResolvedValue(RATE_LIMIT_OK)
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockAuthenticate.mockResolvedValue({
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

  it('delegates normalized IDs through the semantic operation', async () => {
    const request = buildRequest(
      JSON.stringify({
        workspaceId: WORKSPACE_ID,
        knowledgeBaseIds: 'kb-1',
        query: 'hello',
        topK: 10,
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
      },
      request,
    })
    expect(await response.json()).toEqual({
      data: expect.objectContaining({ knowledgeBaseIds: ['kb-1'], totalResults: 1 }),
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-ratelimit-limit')).toBe('100')
  })

  it('authenticates before rejecting malformed JSON', async () => {
    const response = await POST(buildRequest('{'))

    expect(response.status).toBe(400)
    expect(mockAuthenticate).toHaveBeenCalledOnce()
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

  it('preserves the bounded JSON rejection before application execution', async () => {
    const response = await POST(
      buildRequest('{}', { 'content-length': String(DEFAULT_MAX_JSON_BODY_BYTES + 1) })
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
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
