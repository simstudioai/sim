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

const { mockUpdateTag, mockDeleteTag } = vi.hoisted(() => ({
  mockUpdateTag: vi.fn(),
  mockDeleteTag: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  updateKnowledgeTag: { operation: { id: 'knowledge.tags.update' }, execute: mockUpdateTag },
  deleteKnowledgeTag: { operation: { id: 'knowledge.tags.delete' }, execute: mockDeleteTag },
}))

import { DELETE, PATCH } from '@/app/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1', tagId: 'tag-def-1' }) }
const URL_BASE = 'http://localhost/api/v2/knowledge/kb-1/tags/tag-def-1'

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
  mockUpdateTag.mockResolvedValue({
    knowledgeBaseId: 'kb-1',
    tagDefinition: {
      id: 'tag-def-1',
      tagSlot: 'tag1',
      displayName: 'topic',
      fieldType: 'text',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    },
  })
  mockDeleteTag.mockResolvedValue({
    tagDefinitionId: 'tag-def-1',
    tagSlot: 'tag1',
    displayName: 'category',
  })
})

describe('PATCH /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]', () => {
  /**
   * `resolveActiveKnowledgeTagContext` only asserts the parent when the input
   * names one, so a route that omits it answers 200 for a definition belonging
   * to a sibling knowledge base.
   */
  it('binds the definition to the knowledge base the path names', async () => {
    const response = await PATCH(
      new NextRequest(URL_BASE, {
        method: 'PATCH',
        headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID, displayName: 'topic' }),
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: 'tag-def-1', displayName: 'topic', tagSlot: 'tag1', fieldType: 'text' },
    })
    expect(mockUpdateTag).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          tagDefinitionId: 'tag-def-1',
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          updates: { displayName: 'topic', fieldType: undefined },
          source: 'api',
        },
      })
    )
  })

  it('rejects a body that names no field to change', async () => {
    const response = await PATCH(
      new NextRequest(URL_BASE, {
        method: 'PATCH',
        headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockUpdateTag).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]', () => {
  it('reports the freed slot alongside the deleted identifier', async () => {
    const response = await DELETE(
      new NextRequest(`${URL_BASE}?workspaceId=${WORKSPACE_ID}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'secret' },
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: 'tag-def-1', tagSlot: 'tag1', displayName: 'category', deleted: true },
    })
    expect(mockDeleteTag).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ knowledgeBaseId: 'kb-1' }),
      })
    )
  })

  it('requires the workspace scope', async () => {
    const response = await DELETE(
      new NextRequest(URL_BASE, { method: 'DELETE', headers: { 'x-api-key': 'secret' } }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockDeleteTag).not.toHaveBeenCalled()
  })
})
