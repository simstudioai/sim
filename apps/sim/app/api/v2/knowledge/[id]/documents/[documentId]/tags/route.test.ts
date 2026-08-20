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

const { mockSaveDefinitions, mockDeleteDefinitions } = vi.hoisted(() => ({
  mockSaveDefinitions: vi.fn(),
  mockDeleteDefinitions: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/tags', () => ({
  saveKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.save_document_definitions' },
    execute: mockSaveDefinitions,
  },
  deleteKnowledgeDocumentTagDefinitions: {
    operation: { id: 'knowledge.tags.delete_document_definitions' },
    execute: mockDeleteDefinitions,
  },
}))

import { DELETE, PUT } from '@/app/api/v2/knowledge/[id]/documents/[documentId]/tags/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }) }
const URL_BASE = 'http://localhost/api/v2/knowledge/kb-1/documents/doc-1/tags'

const DEFINITION = {
  id: 'tag-def-1',
  knowledgeBaseId: 'kb-1',
  tagSlot: 'tag1',
  displayName: 'category',
  fieldType: 'text',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
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
  mockSaveDefinitions.mockResolvedValue({ created: [DEFINITION], updated: [], errors: [] })
  mockDeleteDefinitions.mockResolvedValue({ action: 'cleanup', count: 3 })
})

function putRequest(body: unknown) {
  return new NextRequest(URL_BASE, {
    method: 'PUT',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/v2/knowledge/[id]/documents/[documentId]/tags', () => {
  it('projects created and updated definitions through the shared tag shape', async () => {
    const response = await PUT(
      putRequest({
        workspaceId: WORKSPACE_ID,
        definitions: [{ tagSlot: 'tag1', displayName: 'category', fieldType: 'text' }],
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        created: [{ id: 'tag-def-1', displayName: 'category', tagSlot: 'tag1', fieldType: 'text' }],
        updated: [],
        errors: [],
      },
    })
  })

  it('rejects an empty definition list', async () => {
    const response = await PUT(putRequest({ workspaceId: WORKSPACE_ID, definitions: [] }), context)

    expect(response.status).toBe(400)
    expect(mockSaveDefinitions).not.toHaveBeenCalled()
  })

  it('rejects a slot that is not a real tag slot', async () => {
    const response = await PUT(
      putRequest({
        workspaceId: WORKSPACE_ID,
        definitions: [{ tagSlot: 'tag99', displayName: 'category', fieldType: 'text' }],
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockSaveDefinitions).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v2/knowledge/[id]/documents/[documentId]/tags', () => {
  it('defaults to cleanup and reports the number removed', async () => {
    const response = await DELETE(
      new NextRequest(`${URL_BASE}?workspaceId=${WORKSPACE_ID}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'secret' },
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { action: 'cleanup', count: 3 } })
    expect(mockDeleteDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ action: 'cleanup' }) })
    )
  })

  /**
   * The contract pins `action`, so the domain's whole-vocabulary branch is
   * unreachable from here — but the presenter used to re-check the domain's
   * reported branch and throw, which would have answered 500 after the delete
   * had already committed. Reading the branch back from the parsed request
   * keeps the check at the type level, where it costs nothing at runtime.
   */
  it('answers the request it parsed, never faulting on the domain result', async () => {
    mockDeleteDefinitions.mockResolvedValue({ action: 'all', count: 3 })

    const response = await DELETE(
      new NextRequest(`${URL_BASE}?workspaceId=${WORKSPACE_ID}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'secret' },
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { action: 'cleanup', count: 3 } })
  })

  /**
   * `action: 'all'` deletes every tag definition on the knowledge base, not the
   * document's. Reaching a whole-vocabulary wipe from a document-scoped path is
   * the destruction this contract exists to keep unreachable.
   */
  it('refuses the whole-knowledge-base delete action', async () => {
    const response = await DELETE(
      new NextRequest(`${URL_BASE}?workspaceId=${WORKSPACE_ID}&action=all`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'secret' },
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockDeleteDefinitions).not.toHaveBeenCalled()
  })
})
