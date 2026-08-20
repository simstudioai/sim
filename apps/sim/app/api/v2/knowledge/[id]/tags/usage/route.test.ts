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

const { mockReadUsage } = vi.hoisted(() => ({
  mockReadUsage: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  readKnowledgeTagUsage: {
    operation: { id: 'knowledge.tags.read_usage' },
    execute: mockReadUsage,
  },
}))

import { GET } from '@/app/api/v2/knowledge/[id]/tags/usage/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ id: 'kb-1' }) }

function request(query: string) {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/tags/usage${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.gate.mockResolvedValue(null)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    rolloutUserId: 'user-1',
    rateLimitSubjectIds: ['api-key:key-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockReadUsage.mockResolvedValue({
    usage: [
      {
        tagSlot: 'tag1',
        displayName: 'category',
        fieldType: 'text',
        documentCount: 4,
        chunkCount: 40,
      },
    ],
  })
})

describe('GET /api/v2/knowledge/[id]/tags/usage', () => {
  it('returns every defined tag as one bounded page', async () => {
    const response = await GET(request(`?workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          tagSlot: 'tag1',
          displayName: 'category',
          fieldType: 'text',
          documentCount: 4,
          chunkCount: 40,
        },
      ],
      nextCursor: null,
    })
  })

  it('requires the workspace scope', async () => {
    const response = await GET(request(''), context)

    expect(response.status).toBe(400)
    expect(mockReadUsage).not.toHaveBeenCalled()
  })
})
