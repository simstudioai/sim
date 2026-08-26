/**
 * @vitest-environment node
 *
 * Covers the JSON halves of the documents collection route (list and bulk
 * update). The multipart upload half is covered in `route.test.ts`, which mocks
 * the stream-limit helpers the JSON body parser also uses.
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

const { mockListDocuments, mockBulkUpdate } = vi.hoisted(() => ({
  mockListDocuments: vi.fn(),
  mockBulkUpdate: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/documents', () => ({
  listKnowledgeDocuments: {
    operation: { id: 'knowledge.documents.list' },
    execute: mockListDocuments,
  },
  bulkUpdateKnowledgeDocuments: {
    operation: { id: 'knowledge.documents.bulk' },
    execute: mockBulkUpdate,
  },
  admitKnowledgeDocumentUpload: {
    operation: { id: 'knowledge.documents.upload' },
    execute: vi.fn(),
  },
  uploadKnowledgeDocument: {
    operation: { id: 'knowledge.documents.upload' },
    execute: vi.fn(),
  },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { GET, PATCH } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route'

const WORKSPACE_ID = 'workspace-1'
const PRINCIPAL = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const
const UPLOADED_AT = new Date('2025-06-18T16:45:00Z')

const TAG_DEFINITIONS = [
  {
    id: 'tag-def-1',
    knowledgeBaseId: 'kb-1',
    tagSlot: 'tag1',
    displayName: 'category',
    fieldType: 'text',
    createdAt: UPLOADED_AT,
    updatedAt: UPLOADED_AT,
  },
]

const DOCUMENT = {
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  filename: 'support.txt',
  fileSize: 5,
  mimeType: 'text/plain',
  processingStatus: 'completed' as const,
  chunkCount: 2,
  tokenCount: 10,
  characterCount: 40,
  enabled: true,
  uploadedAt: UPLOADED_AT,
  tag1: 'billing',
  tag2: null,
}

const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

function buildListRequest(query: string) {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/documents${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

function buildPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v2/knowledge/kb-1/documents', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

function authenticateAsPersonalKey() {
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: PRINCIPAL,
    rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
}

describe('GET /api/v2/knowledge/[knowledgeBaseId]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAsPersonalKey()
    mockListDocuments.mockResolvedValue({
      documents: [DOCUMENT],
      tagDefinitions: TAG_DEFINITIONS,
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
      workspaceId: WORKSPACE_ID,
    })
  })

  it('returns each document with its tag values keyed by display name', async () => {
    const response = await GET(buildListRequest(`?workspaceId=${WORKSPACE_ID}`), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]).toEqual(
      expect.objectContaining({ id: 'doc-1', tags: { category: 'billing' } })
    )
    expect(body.nextCursor).toBeNull()
  })

  it('forwards display-named tag filters to the application use case', async () => {
    const tagFilters = JSON.stringify([{ tagName: 'category', operator: 'eq', value: 'billing' }])

    const response = await GET(
      buildListRequest(`?workspaceId=${WORKSPACE_ID}&tagFilters=${encodeURIComponent(tagFilters)}`),
      context
    )

    expect(response.status).toBe(200)
    expect(mockListDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          tagNameFilters: [{ tagName: 'category', operator: 'eq', value: 'billing' }],
        }),
      })
    )
  })

  it('stamps the tag filters into the cursor so a replayed cursor cannot cross filters', async () => {
    const tagFilters = JSON.stringify([{ tagName: 'category', operator: 'eq', value: 'billing' }])
    mockListDocuments.mockResolvedValue({
      documents: [DOCUMENT],
      tagDefinitions: TAG_DEFINITIONS,
      pagination: { total: 4, limit: 2, offset: 0, hasMore: true },
      workspaceId: WORKSPACE_ID,
    })

    const unfiltered = await (
      await GET(buildListRequest(`?workspaceId=${WORKSPACE_ID}`), context)
    ).json()
    const filtered = await (
      await GET(
        buildListRequest(
          `?workspaceId=${WORKSPACE_ID}&tagFilters=${encodeURIComponent(tagFilters)}`
        ),
        context
      )
    ).json()

    expect(unfiltered.nextCursor).not.toEqual(filtered.nextCursor)

    const replayed = await GET(
      buildListRequest(
        `?workspaceId=${WORKSPACE_ID}&tagFilters=${encodeURIComponent(tagFilters)}&cursor=${encodeURIComponent(unfiltered.nextCursor)}`
      ),
      context
    )

    expect(replayed.status).toBe(400)
  })

  it('rejects malformed and wrongly shaped tag filters with a 400', async () => {
    const malformed = await GET(
      buildListRequest(`?workspaceId=${WORKSPACE_ID}&tagFilters=not-json`),
      context
    )
    const wrongShape = await GET(
      buildListRequest(
        `?workspaceId=${WORKSPACE_ID}&tagFilters=${encodeURIComponent(JSON.stringify([{ tagSlot: 'tag1' }]))}`
      ),
      context
    )

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({
      error: expect.objectContaining({
        message: 'tagFilters must be a JSON-encoded array of tag filters',
      }),
    })
    expect(wrongShape.status).toBe(400)
    expect(mockListDocuments).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v2/knowledge/[knowledgeBaseId]/documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAsPersonalKey()
    mockBulkUpdate.mockResolvedValue({
      operation: 'disable',
      successCount: 2,
      updatedDocuments: [
        { id: 'doc-1', enabled: false },
        { id: 'doc-2', enabled: false },
      ],
      selectAll: false,
    })
  })

  /**
   * `documentIds` is bounded by the request; `selectAll` is bounded by nothing.
   * Echoing the identifiers for a knowledge base of 100k documents is a
   * multi-megabyte array the caller never asked for, materialized and then
   * element-wise validated by the response schema.
   */
  it('omits the identifier echo for an unbounded selectAll update', async () => {
    mockBulkUpdate.mockResolvedValueOnce({
      operation: 'disable',
      successCount: 100_000,
      updatedDocuments: Array.from({ length: 100_000 }, (_, index) => ({
        id: `doc-${index}`,
        enabled: false,
      })),
      selectAll: true,
    })

    const response = await PATCH(
      buildPatchRequest({ workspaceId: WORKSPACE_ID, operation: 'disable', selectAll: true }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { operation: 'disable', updatedCount: 100_000 },
    })
  })

  it('disables the named documents and answers with one object, not a page', async () => {
    const response = await PATCH(
      buildPatchRequest({
        workspaceId: WORKSPACE_ID,
        operation: 'disable',
        documentIds: ['doc-1', 'doc-2'],
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { operation: 'disable', updatedCount: 2, documentIds: ['doc-1', 'doc-2'] },
    })
    expect(mockBulkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          assertedWorkspaceId: WORKSPACE_ID,
          operation: 'disable',
          documentIds: ['doc-1', 'doc-2'],
          selectAll: undefined,
          enabledFilter: undefined,
        },
      })
    )
  })

  it('does not expose an unaudited bulk delete', async () => {
    const response = await PATCH(
      buildPatchRequest({
        workspaceId: WORKSPACE_ID,
        operation: 'delete',
        documentIds: ['doc-1'],
      }),
      context
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        message: expect.stringContaining('operation: expected one of "enable" | "disable"'),
      }),
    })
    expect(mockBulkUpdate).not.toHaveBeenCalled()
  })

  it('requires exactly one selection and bounds an explicit list', async () => {
    const neither = await PATCH(
      buildPatchRequest({ workspaceId: WORKSPACE_ID, operation: 'enable' }),
      context
    )
    const both = await PATCH(
      buildPatchRequest({
        workspaceId: WORKSPACE_ID,
        operation: 'enable',
        documentIds: ['doc-1'],
        selectAll: true,
      }),
      context
    )
    const tooMany = await PATCH(
      buildPatchRequest({
        workspaceId: WORKSPACE_ID,
        operation: 'enable',
        documentIds: Array.from({ length: 101 }, (_, index) => `doc-${index}`),
      }),
      context
    )

    expect(neither.status).toBe(400)
    expect(both.status).toBe(400)
    expect(tooMany.status).toBe(400)
    expect(mockBulkUpdate).not.toHaveBeenCalled()
  })
})
