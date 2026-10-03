import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListTags, mockCreateTag, mockBulkSave, mockDeleteDefinitions } = vi.hoisted(() => ({
  mockListTags: vi.fn(),
  mockCreateTag: vi.fn(),
  mockBulkSave: vi.fn(),
  mockDeleteDefinitions: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  listKnowledgeTags: { operation: { id: 'knowledge.tags.list' }, execute: mockListTags },
  createKnowledgeTag: { operation: { id: 'knowledge.tags.create' }, execute: mockCreateTag },
  saveKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.bulk_save' },
    execute: mockBulkSave,
  },
  deleteKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.cleanup' },
    execute: mockDeleteDefinitions,
  },
}))

import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { DELETE } from '@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route'

const WORKSPACE_ID = 'workspace-1'

const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

describe('POST /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  /**
   * Reads share the vocabulary with document filtering, which a workspace key
   * may already perform; defining the vocabulary is a write and does not.
   */
  it('denies a workspace API key, unlike the sibling read', () => {
    expect(knowledgeOperations.createTag.workspaceApiKey).toBe('deny')
    expect(knowledgeOperations.createTag.principalKinds).not.toContain('workspace_api_key')
  })
})

describe('DELETE /api/v2/knowledge/[knowledgeBaseId]/tags', () => {
  beforeEach(() => {
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockDeleteDefinitions.mockResolvedValue({ action: 'cleanup', count: 2 })
  })

  function buildDeleteRequest(query: string) {
    return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/tags${query}`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'secret' },
    })
  }

  it('removes only the unused definitions by default', async () => {
    const response = await DELETE(buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { unused: true, count: 2 } })
    expect(mockDeleteDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          action: 'cleanup',
        },
      })
    )
  })

  it('deletes the whole vocabulary only when asked in so many words', async () => {
    mockDeleteDefinitions.mockResolvedValue({ action: 'all', count: 7 })

    const response = await DELETE(
      buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}&unused=false`),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { unused: false, count: 7 } })
    expect(mockDeleteDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ action: 'all' }) })
    )
  })

  /**
   * `unused` is a real boolean via `booleanQueryFlagSchema`, not a string enum,
   * so an unrecognised spelling is a 400 rather than a silent truthy read that
   * would delete the wrong half of the vocabulary.
   */
  it('rejects a spelling of unused it does not accept', async () => {
    const response = await DELETE(
      buildDeleteRequest(`?workspaceId=${WORKSPACE_ID}&unused=maybe`),
      context
    )

    expect(response.status).toBe(400)
    expect(mockDeleteDefinitions).not.toHaveBeenCalled()
  })
})
