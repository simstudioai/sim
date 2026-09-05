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

const { mockListChunks, mockCreateChunk, mockBulkChunks } = vi.hoisted(() => ({
  mockListChunks: vi.fn(),
  mockCreateChunk: vi.fn(),
  mockBulkChunks: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/chunks', () => ({
  listKnowledgeChunks: { operation: { id: 'knowledge.chunks.list' }, execute: mockListChunks },
  createKnowledgeChunk: { operation: { id: 'knowledge.chunks.create' }, execute: mockCreateChunk },
  bulkUpdateKnowledgeChunks: {
    operation: { id: 'knowledge.chunks.bulk' },
    execute: mockBulkChunks,
  },
}))

import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  GET,
  PATCH,
  POST,
} from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route'

const WORKSPACE_ID = 'workspace-1'
const OTHER_WORKSPACE_ID = 'workspace-2'
const PRINCIPAL = { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' } as const
const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1', documentId: 'doc-1' }) }
const siblingContext = { params: Promise.resolve({ knowledgeBaseId: 'kb-1', documentId: 'doc-2' }) }

const CHUNK = {
  id: 'chunk-1',
  chunkIndex: 0,
  content: 'Open Settings and choose Security.',
  contentLength: 33,
  tokenCount: 8,
  enabled: true,
  startOffset: 0,
  endOffset: 33,
  tag1: 'billing',
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

function listRequest(query = `?workspaceId=${WORKSPACE_ID}`) {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/documents/doc-1/chunks${query}`, {
    headers: { 'x-api-key': 'secret' },
  })
}

function bodyRequest(method: 'POST' | 'PATCH', body: unknown, documentId = 'doc-1') {
  return new NextRequest(`http://localhost/api/v2/knowledge/kb-1/documents/${documentId}/chunks`, {
    method,
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: PRINCIPAL,
    rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockListChunks.mockResolvedValue({ chunks: [CHUNK], nextCursorKeys: null })
  mockCreateChunk.mockResolvedValue({ chunk: CHUNK })
  mockBulkChunks.mockResolvedValue({
    operation: 'disable',
    successCount: 2,
    errorCount: 0,
    processed: 2,
    errors: [],
  })
})

describe('GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks', () => {
  it('projects chunks with their tag slots and no cursor on the last page', async () => {
    const response = await GET(listRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: [
        {
          ...CHUNK,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('mints a cursor bound to the sort when there is another page', async () => {
    mockListChunks.mockResolvedValue({ chunks: [CHUNK], nextCursorKeys: [0, 'chunk-1'] })

    const nextCursor = (await (await GET(listRequest(), context)).json()).nextCursor
    expect(typeof nextCursor).toBe('string')

    const resumed = await GET(
      listRequest(`?workspaceId=${WORKSPACE_ID}&cursor=${encodeURIComponent(nextCursor)}`),
      context
    )
    expect(resumed.status).toBe(200)
    expect(mockListChunks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ cursorKeys: [0, 'chunk-1'] }),
      })
    )
  })

  /**
   * The cursor names a position in ONE document's chunk sequence. Replaying it
   * against a sibling document would answer 200 from a sequence the caller
   * never walked, which is the regression `CURSOR_BOUND_PATH_PARAMS` pins.
   */
  it('refuses a cursor minted for a sibling document', async () => {
    mockListChunks.mockResolvedValue({ chunks: [CHUNK], nextCursorKeys: [0, 'chunk-1'] })
    const nextCursor = (await (await GET(listRequest(), context)).json()).nextCursor

    const response = await GET(
      new NextRequest(
        `http://localhost/api/v2/knowledge/kb-1/documents/doc-2/chunks?workspaceId=${WORKSPACE_ID}&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: { 'x-api-key': 'secret' } }
      ),
      siblingContext
    )

    expect(response.status).toBe(400)
  })

  /**
   * `workspaceId` is asserted scope, not a filter: the sequence is the one
   * document the path names, and a workspace that does not own it is refused by
   * authorization long before paging. Binding it into the cursor would refuse a
   * page that did not move, which is the reading the structurally identical
   * table-row lists already record in `list-pagination.test.ts`.
   */
  it('resumes a cursor under a different asserted workspace, leaving that to authorization', async () => {
    mockListChunks.mockResolvedValue({ chunks: [CHUNK], nextCursorKeys: [0, 'chunk-1'] })
    const nextCursor = (await (await GET(listRequest(), context)).json()).nextCursor

    const response = await GET(
      listRequest(`?workspaceId=${OTHER_WORKSPACE_ID}&cursor=${encodeURIComponent(nextCursor)}`),
      context
    )

    expect(response.status).toBe(200)
    expect(mockListChunks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          assertedWorkspaceId: OTHER_WORKSPACE_ID,
          cursorKeys: [0, 'chunk-1'],
        }),
      })
    )
  })

  it('refuses a cursor replayed under a different sort', async () => {
    mockListChunks.mockResolvedValue({ chunks: [CHUNK], nextCursorKeys: [0, 'chunk-1'] })
    const nextCursor = (await (await GET(listRequest(), context)).json()).nextCursor

    const response = await GET(
      listRequest(
        `?workspaceId=${WORKSPACE_ID}&sortBy=tokenCount&cursor=${encodeURIComponent(nextCursor)}`
      ),
      context
    )

    expect(response.status).toBe(400)
  })

  it('rejects a fractional limit rather than passing it to the query', async () => {
    const response = await GET(listRequest(`?workspaceId=${WORKSPACE_ID}&limit=1.5`), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('limit')
    expect(mockListChunks).not.toHaveBeenCalled()
  })

  it('rejects an undeclared query key rather than dropping it', async () => {
    const response = await GET(listRequest(`?workspaceId=${WORKSPACE_ID}&offset=10`), context)

    expect(response.status).toBe(400)
    expect(mockListChunks).not.toHaveBeenCalled()
  })

  it('answers 409 while the document is still processing', async () => {
    mockListChunks.mockRejectedValue(new KnowledgeDocumentNotReadyError('processing'))

    const response = await GET(listRequest(), context)

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toContain('processing')
    expect(response.headers.get('retry-after')).toBeNull()
  })

  it('conceals a knowledge base the caller cannot reach as not found', async () => {
    const { NoWorkspaceAccessError } = await import('@/lib/core/application')
    mockListChunks.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(listRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('Knowledge base not found')
  })
})

describe('POST /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks', () => {
  it('creates a chunk and answers 201', async () => {
    const response = await POST(
      bodyRequest('POST', { workspaceId: WORKSPACE_ID, content: 'Some text' }),
      context
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data.id).toBe('chunk-1')
  })

  /**
   * A provenance envelope is a trusted in-process trace. The public surface has
   * none, and must not accept one from the wire.
   */
  it('supplies no secret provenance to the use case', async () => {
    await POST(bodyRequest('POST', { workspaceId: WORKSPACE_ID, content: 'Some text' }), context)

    const { input } = mockCreateChunk.mock.calls[0][0]
    expect(input.resolveContentProvenance({ userId: 'user-1' })).toBeUndefined()
  })

  it('surfaces a connector-managed refusal with a machine-readable cause', async () => {
    mockCreateChunk.mockRejectedValue(
      new ForbiddenOperationError(
        'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
        'Chunks from connector-synced documents are read-only'
      )
    )

    const response = await POST(
      bodyRequest('POST', { workspaceId: WORKSPACE_ID, content: 'Some text' }),
      context
    )

    expect(response.status).toBe(403)
    expect((await response.json()).error.details).toEqual({
      code: 'CONNECTOR_MANAGED_RESOURCE_READ_ONLY',
    })
  })

  it('rejects empty content at the contract', async () => {
    const response = await POST(
      bodyRequest('POST', { workspaceId: WORKSPACE_ID, content: '' }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockCreateChunk).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks', () => {
  it('reports the processed count and per-chunk failures', async () => {
    const response = await PATCH(
      bodyRequest('PATCH', {
        workspaceId: WORKSPACE_ID,
        operation: 'disable',
        chunkIds: ['chunk-1', 'chunk-2'],
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { operation: 'disable', processed: 2, errors: [] },
    })
  })

  /**
   * The bound is enforced at the contract so the domain's own throw is
   * unreachable from the wire — an over-long list is a 400 naming the cap
   * rather than a classified failure from inside the use case.
   */
  it('caps the identifier list before the use case runs', async () => {
    const response = await PATCH(
      bodyRequest('PATCH', {
        workspaceId: WORKSPACE_ID,
        operation: 'delete',
        chunkIds: Array.from({ length: 101 }, (_, index) => `chunk-${index}`),
      }),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('100')
    expect(mockBulkChunks).not.toHaveBeenCalled()
  })
})

describe('chunk operation policy', () => {
  it('allows ACL-filtered chunk listing while retaining the other chunk policies', () => {
    expect(knowledgeOperations.listChunks.workspaceApiKey).toBe('allow')
    expect(knowledgeOperations.listChunks.principalKinds).toContain('workspace_api_key')
    for (const operation of [
      knowledgeOperations.readChunk,
      knowledgeOperations.createChunk,
      knowledgeOperations.updateChunk,
      knowledgeOperations.deleteChunk,
      knowledgeOperations.bulkChunks,
    ]) {
      expect(operation.workspaceApiKey).toBe('deny')
      expect(operation.principalKinds).not.toContain('workspace_api_key')
    }
  })
})
