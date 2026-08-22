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

const { mockReadDocument, mockUpdateDocument, mockDeleteDocument, mockCapture } = vi.hoisted(
  () => ({
    mockReadDocument: vi.fn(),
    mockUpdateDocument: vi.fn(),
    mockDeleteDocument: vi.fn(),
    mockCapture: vi.fn(),
  })
)

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

vi.mock('@/lib/knowledge/application/documents', () => ({
  readKnowledgeDocument: {
    operation: { id: 'knowledge.documents.read' },
    execute: mockReadDocument,
  },
  updateKnowledgeDocument: {
    operation: { id: 'knowledge.documents.update' },
    execute: mockUpdateDocument,
  },
  deleteKnowledgeDocument: {
    operation: { id: 'knowledge.documents.delete' },
    execute: mockDeleteDocument,
  },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCapture }))

import { GET, PATCH } from '@/app/api/v2/knowledge/[id]/documents/[documentId]/route'

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
  {
    id: 'tag-def-2',
    knowledgeBaseId: 'kb-1',
    tagSlot: 'number1',
    displayName: 'priority',
    fieldType: 'number',
    createdAt: UPLOADED_AT,
    updatedAt: UPLOADED_AT,
  },
]

const DOCUMENT_ROW = {
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  filename: 'support.txt',
  fileSize: 5,
  mimeType: 'text/plain',
  processingStatus: 'completed' as const,
  processingError: null,
  processingStartedAt: UPLOADED_AT,
  processingCompletedAt: UPLOADED_AT,
  chunkCount: 2,
  tokenCount: 10,
  characterCount: 40,
  enabled: true,
  connectorId: null,
  connectorType: null,
  sourceUrl: null,
  uploadedAt: UPLOADED_AT,
  tag1: 'billing',
  tag2: null,
  number1: 2,
  date1: null,
  boolean1: null,
  tag6: 'orphaned-slot-value',
}

const context = { params: Promise.resolve({ id: 'kb-1', documentId: 'doc-1' }) }

function buildGetRequest() {
  return new NextRequest(
    `http://localhost/api/v2/knowledge/kb-1/documents/doc-1?workspaceId=${WORKSPACE_ID}`,
    { headers: { 'x-api-key': 'secret' } }
  )
}

function buildPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v2/knowledge/kb-1/documents/doc-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/knowledge/[id]/documents/[documentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: PRINCIPAL,
      rolloutUserId: 'user-1',
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    mockReadDocument.mockResolvedValue({
      document: DOCUMENT_ROW,
      tagDefinitions: TAG_DEFINITIONS,
      workspaceId: WORKSPACE_ID,
    })
    mockUpdateDocument.mockResolvedValue({
      kind: 'updated',
      document: { ...DOCUMENT_ROW, filename: 'renamed.txt', enabled: false },
      tagDefinitions: TAG_DEFINITIONS,
      updatedFields: ['filename', 'enabled'],
    })
  })

  it('keys document tag values by display name, falling back to the raw slot', async () => {
    const response = await GET(buildGetRequest(), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.tags).toEqual({
      category: 'billing',
      priority: 2,
      tag6: 'orphaned-slot-value',
    })
  })

  it('updates the whitelisted fields and returns the updated document with its tags', async () => {
    const response = await PATCH(
      buildPatchRequest({
        workspaceId: WORKSPACE_ID,
        filename: 'renamed.txt',
        enabled: false,
        tag1: 'support',
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          knowledgeBaseId: 'kb-1',
          documentId: 'doc-1',
          assertedWorkspaceId: WORKSPACE_ID,
          updates: { filename: 'renamed.txt', enabled: false, tag1: 'support' },
          source: 'api',
        },
      })
    )
    const body = await response.json()
    expect(body.data).toEqual(
      expect.objectContaining({
        id: 'doc-1',
        filename: 'renamed.txt',
        enabled: false,
        tags: { category: 'billing', priority: 2, tag6: 'orphaned-slot-value' },
      })
    )
  })

  it('acknowledges a processing retry without claiming settled indexing state', async () => {
    mockUpdateDocument.mockResolvedValueOnce({
      kind: 'processing',
      documentId: 'doc-1',
      status: 'pending',
      message: 'Document processing restarted',
    })

    const response = await PATCH(
      buildPatchRequest({ workspaceId: WORKSPACE_ID, retryProcessing: true }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: 'doc-1',
        queued: true,
        processingStatus: 'pending',
        message: 'Document processing restarted',
      },
    })
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ retryProcessing: true }),
      })
    )
    expect(mockUpdateDocument.mock.calls[0][0].input).not.toHaveProperty('updates')
  })

  it('refuses to let a caller assert derived indexing state', async () => {
    for (const body of [
      { workspaceId: WORKSPACE_ID, processingStatus: 'completed' },
      { workspaceId: WORKSPACE_ID, chunkCount: 99 },
      { workspaceId: WORKSPACE_ID, tokenCount: 99 },
      { workspaceId: WORKSPACE_ID, processingError: null },
      { workspaceId: WORKSPACE_ID, markFailedDueToTimeout: true },
    ]) {
      const response = await PATCH(buildPatchRequest(body), context)
      expect(response.status).toBe(400)
    }
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })

  it('rejects a retry combined with field updates instead of silently dropping them', async () => {
    const response = await PATCH(
      buildPatchRequest({ workspaceId: WORKSPACE_ID, retryProcessing: true, enabled: false }),
      context
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: expect.objectContaining({
        message: expect.stringContaining('retryProcessing cannot be combined with enabled'),
      }),
    })
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })

  it('rejects an update that changes nothing', async () => {
    const response = await PATCH(buildPatchRequest({ workspaceId: WORKSPACE_ID }), context)

    expect(response.status).toBe(400)
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })
})
