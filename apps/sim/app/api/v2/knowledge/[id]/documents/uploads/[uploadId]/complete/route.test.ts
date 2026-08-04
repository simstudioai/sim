/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockCompleteUploadSession,
  mockDeleteFile,
  mockDeleteFileMetadata,
  mockPerformUploadKnowledgeDocument,
  mockRecordKnowledgeBaseFileOwnership,
  mockResolveKnowledgeDocumentUploadAccess,
  mockResolveKnowledgeDocumentUploadAttribution,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockCompleteUploadSession: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDeleteFileMetadata: vi.fn(),
  mockPerformUploadKnowledgeDocument: vi.fn(),
  mockRecordKnowledgeBaseFileOwnership: vi.fn(),
  mockResolveKnowledgeDocumentUploadAccess: vi.fn(),
  mockResolveKnowledgeDocumentUploadAttribution: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/knowledge/orchestration', () => ({
  performUploadKnowledgeDocument: mockPerformUploadKnowledgeDocument,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
  recordKnowledgeBaseFileOwnership: mockRecordKnowledgeBaseFileOwnership,
}))
vi.mock('@/lib/uploads/multipart-session/service', () => ({
  completeUploadSession: mockCompleteUploadSession,
}))
vi.mock('@/app/api/v2/knowledge/[id]/documents/uploads/utils', () => ({
  getOwnedKnowledgeDocumentUpload: vi.fn(() => SESSION),
  knowledgeDocumentFileUrl: vi.fn(() => FILE_URL),
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

import { POST } from '@/app/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const FILE_URL = '/api/files/serve/s3/kb%2Fguide.pdf?context=knowledge-base'
const SESSION = {
  id: 'upload-1',
  workspaceId: WORKSPACE_ID,
  userId: 'user-1',
  knowledgeBaseId: 'kb-1',
  purpose: 'knowledge_document',
  storageContext: 'knowledge-base',
  storageKey: 'kb/guide.pdf',
  storageProvider: 's3',
  providerUploadId: 'provider-1',
  fileName: 'guide.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  partSize: 8 * 1024 * 1024,
  partCount: 1,
  status: 'uploading',
  metadata: {},
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
        headers: { 'Content-Type': 'application/json', 'upload-token': 'token' },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'etag-1' }] }),
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
    mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    mockDeleteFileMetadata.mockResolvedValue(true)
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: true,
      document: DOCUMENT,
      created: true,
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

  it('records knowledge ownership and invokes the shared document orchestration', async () => {
    const response = await request()

    expect(response.status).toBe(200)
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith({
      key: 'kb/guide.pdf',
      userId: 'user-1',
      workspaceId: WORKSPACE_ID,
      originalName: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })
    expect(mockPerformUploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'upload-1',
        startProcessing: 'queue',
        uploadedBy: 'payer-1',
        document: {
          filename: 'guide.pdf',
          fileUrl: FILE_URL,
          fileSize: 1024,
          mimeType: 'application/pdf',
        },
      })
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })

  it('finalizes an already-admitted upload without re-running usage admission', async () => {
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: true,
      document: DOCUMENT,
      created: false,
    })

    const response = await request()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { document: { id: 'upload-1' } } })
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('removes the committed object and ownership binding when document creation fails', async () => {
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: false,
      errorCode: 'payload_too_large',
      error: 'Storage limit exceeded',
    })

    const response = await request()

    expect(response.status).toBe(413)
    expect(mockDeleteFile).toHaveBeenCalledWith({
      key: 'kb/guide.pdf',
      context: 'knowledge-base',
    })
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/guide.pdf')
  })
})
