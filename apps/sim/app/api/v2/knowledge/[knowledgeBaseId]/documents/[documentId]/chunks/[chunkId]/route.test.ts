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

const { mockReadChunk, mockUpdateChunk, mockDeleteChunk } = vi.hoisted(() => ({
  mockReadChunk: vi.fn(),
  mockUpdateChunk: vi.fn(),
  mockDeleteChunk: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/chunks', () => ({
  readKnowledgeChunk: { operation: { id: 'knowledge.chunks.read' }, execute: mockReadChunk },
  updateKnowledgeChunk: { operation: { id: 'knowledge.chunks.update' }, execute: mockUpdateChunk },
  deleteKnowledgeChunk: { operation: { id: 'knowledge.chunks.delete' }, execute: mockDeleteChunk },
}))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import {
  DELETE,
  GET,
  PATCH,
} from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]/route'

const WORKSPACE_ID = 'workspace-1'
const context = {
  params: Promise.resolve({ knowledgeBaseId: 'kb-1', documentId: 'doc-1', chunkId: 'chunk-1' }),
}

const CHUNK = {
  id: 'chunk-1',
  chunkIndex: 4,
  content: 'Open Settings and choose Security.',
  contentLength: 33,
  tokenCount: 8,
  enabled: false,
  startOffset: 0,
  endOffset: 33,
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

const URL_BASE = 'http://localhost/api/v2/knowledge/kb-1/documents/doc-1/chunks/chunk-1'

function readRequest(method: 'GET' | 'DELETE', query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`${URL_BASE}${query}`, { method, headers: { 'x-api-key': 'secret' } })
}

function patchRequest(body: unknown) {
  return new NextRequest(URL_BASE, {
    method: 'PATCH',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
  mockReadChunk.mockResolvedValue({ chunk: CHUNK })
  mockUpdateChunk.mockResolvedValue({ chunk: CHUNK })
  mockDeleteChunk.mockResolvedValue({ deleted: true })
})

describe('GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]', () => {
  it('resolves the chunk through its knowledge base and document', async () => {
    const response = await GET(readRequest('GET'), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.chunkIndex).toBe(4)
    expect(mockReadChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          assertedWorkspaceId: WORKSPACE_ID,
        },
      })
    )
  })

  it('requires the workspace scope', async () => {
    const response = await GET(readRequest('GET', ''), context)

    expect(response.status).toBe(400)
    expect(mockReadChunk).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]', () => {
  it('updates the chunk and returns its current representation', async () => {
    const response = await PATCH(
      patchRequest({ workspaceId: WORKSPACE_ID, enabled: false }),
      context
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.enabled).toBe(false)
  })

  it('rejects a body that names no field to change', async () => {
    const response = await PATCH(patchRequest({ workspaceId: WORKSPACE_ID }), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('content')
    expect(mockUpdateChunk).not.toHaveBeenCalled()
  })

  it('surfaces a connector-managed refusal with a machine-readable cause', async () => {
    mockUpdateChunk.mockRejectedValue(
      new ForbiddenOperationError(
        'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
        'Chunks from connector-synced documents are read-only'
      )
    )

    const response = await PATCH(
      patchRequest({ workspaceId: WORKSPACE_ID, content: 'Corrected text' }),
      context
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error.details).toEqual({
      code: 'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
    })
  })
})

describe('DELETE /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]', () => {
  it('acknowledges the deletion with the chunk identifier', async () => {
    const response = await DELETE(readRequest('DELETE'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: 'chunk-1', deleted: true } })
  })
})
