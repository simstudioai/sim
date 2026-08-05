/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockCompleteUploadSession,
  mockFinalizeKnowledgeDocumentUpload,
  mockResolveKnowledgeDocumentUploadAccess,
  mockResolveKnowledgeDocumentUploadAttribution,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockCompleteUploadSession: vi.fn(),
  mockFinalizeKnowledgeDocumentUpload: vi.fn(),
  mockResolveKnowledgeDocumentUploadAccess: vi.fn(),
  mockResolveKnowledgeDocumentUploadAttribution: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads/upload-session/service', () => ({
  completeUploadSession: mockCompleteUploadSession,
}))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  finalizeKnowledgeDocumentUpload: mockFinalizeKnowledgeDocumentUpload,
  getOwnedKnowledgeDocumentUpload: vi.fn(() => SESSION),
  resolveKnowledgeDocumentUploadAccess: mockResolveKnowledgeDocumentUploadAccess,
  resolveKnowledgeDocumentUploadAttribution: mockResolveKnowledgeDocumentUploadAttribution,
  toV2KnowledgeDocumentUpload: (session: Record<string, unknown>, document: unknown) => ({
    ...session,
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: '2026-08-04T21:00:00.000Z',
    document,
  }),
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FILE_URL = '/api/files/serve/s3/kb%2Fguide.pdf?context=knowledge-base'
const SESSION = {
  id: 'upload-1',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
  knowledgeBaseId: 'kb-1',
  workflowId: null,
  executionId: null,
  purpose: 'knowledge_document',
  method: 'multipart',
  storageContext: 'knowledge-base',
  storageKey: 'kb/guide.pdf',
  finalKey: 'kb/guide.pdf',
  storageProvider: 's3',
  providerUploadId: 'provider-1',
  providerObjectVersion: null,
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  partSize: 8 * 1024 * 1024,
  partCount: 1,
  status: 'uploading',
  metadata: {
    tag1: 'product',
    processingOptions: { recipe: 'default', lang: 'en' },
  },
  uploadToken: 'token',
  createdAt: new Date('2026-08-03T21:00:00.000Z'),
  expiresAt: new Date('2026-08-04T21:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: new Date('2026-08-03T21:00:00.000Z'),
} as const
const DOCUMENT = {
  id: 'upload-1',
  knowledgeBaseId: 'kb-1',
  filename: 'guide.pdf',
  fileUrl: FILE_URL,
  fileSize: 1024,
  mimeType: 'application/pdf',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  enabled: true,
  uploadedAt: new Date('2026-08-03T21:01:00.000Z'),
}
const RATE_LIMIT = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-03T22:00:00.000Z'),
}

function request() {
  return POST(
    new NextRequest(
      `http://localhost:3000/api/v2/knowledge/kb-1/documents/uploads/upload-1/complete?workspaceId=${WORKSPACE_ID}`,
      {
        method: 'POST',
        headers: { 'upload-token': 'token' },
      }
    ),
    { params: Promise.resolve({ id: 'kb-1', uploadId: 'upload-1' }) }
  )
}

describe('POST knowledge-document multipart completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT)
    mockResolveKnowledgeDocumentUploadAccess.mockResolvedValue({
      kb: { id: 'kb-1', name: 'Docs' },
    })
    mockResolveKnowledgeDocumentUploadAttribution.mockResolvedValue({ actorUserId: 'payer-1' })
    mockFinalizeKnowledgeDocumentUpload.mockResolvedValue({
      value: DOCUMENT,
      completedFileId: DOCUMENT.id,
    })
    mockCompleteUploadSession.mockImplementation(async ({ session, finalize }) => {
      const finalized = await finalize(session)
      return {
        session: { ...session, status: 'completed', completedFileId: finalized.completedFileId },
        value: finalized.value,
        alreadyCompleted: false,
      }
    })
  })

  it('delegates completion to the shared finalizer and returns the bound document', async () => {
    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { document: { id: 'upload-1' } } })
    expect(mockFinalizeKnowledgeDocumentUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed: SESSION,
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: 'Docs',
        workspaceId: WORKSPACE_ID,
        userId: 'user-1',
        source: 'api',
      })
    )
    expect(mockCompleteUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: SESSION,
      })
    )
  })

  it('resolves the payer lazily, only when the finalizer asks for one', async () => {
    await request()

    expect(mockResolveKnowledgeDocumentUploadAttribution).not.toHaveBeenCalled()

    const { resolveAttribution } = mockFinalizeKnowledgeDocumentUpload.mock.calls[0][0]
    await resolveAttribution()

    expect(mockResolveKnowledgeDocumentUploadAttribution).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      rateLimit: RATE_LIMIT,
    })
  })

  it('maps an orchestration failure from the finalizer onto its v2 status', async () => {
    mockFinalizeKnowledgeDocumentUpload.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Storage limit exceeded')
    )

    const response = await request()

    expect(response.status).toBe(413)
  })
})
