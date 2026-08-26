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

const { mockReadNextSlot } = vi.hoisted(() => ({
  mockReadNextSlot: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  readNextKnowledgeTagSlot: {
    operation: { id: 'knowledge.tags.read_next_slot' },
    execute: mockReadNextSlot,
  },
}))

import { GET } from '@/app/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

function request(query: string) {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/tags/next-slot${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    rateLimitSubjectIds: ['api-key:key-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockReadNextSlot.mockResolvedValue({
    nextAvailableSlot: 'tag2',
    fieldType: 'text',
    usedSlots: ['tag1'],
    totalSlots: 7,
    availableSlots: 6,
  })
})

describe('GET /api/v2/knowledge/[knowledgeBaseId]/tags/next-slot', () => {
  it('reports the slot a create would take for the field type', async () => {
    const response = await GET(request(`?workspaceId=${WORKSPACE_ID}&fieldType=text`), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.nextAvailableSlot).toBe('tag2')
  })

  it('requires the field type the slots are counted for', async () => {
    const response = await GET(request(`?workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(400)
    expect(mockReadNextSlot).not.toHaveBeenCalled()
  })

  it('rejects a field type outside the supported set', async () => {
    const response = await GET(request(`?workspaceId=${WORKSPACE_ID}&fieldType=uuid`), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('fieldType')
    expect(mockReadNextSlot).not.toHaveBeenCalled()
  })
})
