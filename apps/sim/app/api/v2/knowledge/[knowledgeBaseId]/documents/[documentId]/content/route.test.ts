import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  authorizeRead: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/read-original-document', () => ({
  readOriginalKnowledgeDocument: {
    operation: { id: 'knowledge.documents.read', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: mocks.read,
    authorize: mocks.authorizeRead,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/content/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const KNOWLEDGE_BASE_ID = 'e0d2c0c8-3b4c-4a9f-9a3e-2f1d5c7b8a90'
const DOCUMENT_ID = 'b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12'
const context = {
  params: Promise.resolve({ knowledgeBaseId: KNOWLEDGE_BASE_ID, documentId: DOCUMENT_ID }),
}

const AUTH = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
    access: 'read' as const,
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    documentId: DOCUMENT_ID,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    name: 'Q3 plan ü.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed',
    indexReady: true,
    hasRecordedSecrets: false,
    ...overrides,
  }
}

function contentRequest() {
  return new NextRequest(
    `http://localhost:3000/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/documents/${DOCUMENT_ID}/content?workspaceId=${WORKSPACE_ID}`,
    { headers: { 'x-api-key': 'secret' } }
  )
}

describe('GET /api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/content', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.authorizeRead.mockResolvedValue(undefined)
  })

  it('answers exactly the stored bytes, even from a slice of a larger buffer', async () => {
    const pooled = Buffer.from('xx%PDF-bytesyy')
    const bytes = pooled.subarray(2, pooled.length - 2)
    mocks.read.mockResolvedValue(document({ sourceAvailable: true, buffer: bytes }))

    const response = await GET(contentRequest(), context)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-bytes')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(response.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('Q3 plan ü.pdf')}`
    )
  })

  it('answers 404 for a document whose original is not stored', async () => {
    mocks.read.mockResolvedValue(document({ sourceAvailable: false, buffer: undefined }))

    const response = await GET(contentRequest(), context)

    expect(response.status).toBe(404)
  })

  it('conceals a knowledge base of another workspace as 404', async () => {
    mocks.read.mockRejectedValue(new NoWorkspaceAccessError())

    const response = await GET(contentRequest(), context)

    expect(response.status).toBe(404)
  })
})
