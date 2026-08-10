/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: {
    operation: { id: 'knowledge.tags.list' },
    execute: mocks.list,
  },
  createKnowledgeTag: {
    operation: { id: 'knowledge.tags.create' },
    execute: mocks.create,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH } from '@/lib/knowledge/constants'
import { GET, POST } from '@/app/api/knowledge/[id]/tag-definitions/route'

const session = {
  user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
  session: { id: 'session-123' },
}

const tagDefinition = {
  id: 'tag-def-1',
  knowledgeBaseId: 'knowledge-1',
  tagSlot: 'tag1',
  displayName: 'Client Name',
  fieldType: 'text',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

const expectedTagDefinition = {
  id: 'tag-def-1',
  tagSlot: 'tag1',
  displayName: 'Client Name',
  fieldType: 'text',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

const params = () => ({ params: Promise.resolve({ id: 'knowledge-1' }) })

describe('/api/knowledge/[id]/tag-definitions internal route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.list.mockResolvedValue({ tagDefinitions: [tagDefinition] })
    mocks.create.mockResolvedValue({ tagDefinition, knowledgeBaseId: 'knowledge-1' })
  })

  it('authenticates before parsing malformed create input', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const request = new NextRequest('http://localhost/api/knowledge/knowledge-1/tag-definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    const response = await POST(request, params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('maps a tag list request to the authorized application use case', async () => {
    const request = createMockRequest('GET')

    const response = await GET(request, params())

    expect(mocks.list).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
      input: { knowledgeBaseId: 'knowledge-1' },
      request,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: [expectedTagDefinition],
    })
  })

  it('maps tag creation to the authorized application use case with its source', async () => {
    const request = createMockRequest('POST', {
      tagSlot: 'tag1',
      displayName: 'Client Name',
      fieldType: 'text',
    })

    const response = await POST(request, params())

    expect(mocks.create).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'user-123', sessionId: 'session-123' },
      input: {
        knowledgeBaseId: 'knowledge-1',
        tagSlot: 'tag1',
        displayName: 'Client Name',
        fieldType: 'text',
        source: 'ui',
      },
      request,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: expectedTagDefinition,
    })
  })

  it('preserves boundary validation without invoking the application use case', async () => {
    const response = await POST(
      createMockRequest('POST', {
        tagSlot: 'tag1',
        displayName: 'a'.repeat(KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH + 1),
        fieldType: 'text',
      }),
      params()
    )

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('projects typed application validation failures', async () => {
    mocks.create.mockRejectedValueOnce(
      new OrchestrationError('validation', 'Tag slot "tag99" is not valid for field type "text"')
    )

    const response = await POST(
      createMockRequest('POST', {
        tagSlot: 'tag99',
        displayName: 'Client Name',
        fieldType: 'text',
      }),
      params()
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Tag slot "tag99" is not valid for field type "text"',
    })
  })
})
