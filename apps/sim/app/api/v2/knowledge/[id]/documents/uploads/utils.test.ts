/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDeleteFile,
  mockDeleteFileMetadata,
  mockFindBoundKnowledgeDocument,
  mockPerformUploadKnowledgeDocument,
  mockRecordKnowledgeBaseFileOwnership,
} = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockDeleteFileMetadata: vi.fn(),
  mockFindBoundKnowledgeDocument: vi.fn(),
  mockPerformUploadKnowledgeDocument: vi.fn(),
  mockRecordKnowledgeBaseFileOwnership: vi.fn(),
}))

vi.mock('@/lib/knowledge/orchestration', () => ({
  performUploadKnowledgeDocument: mockPerformUploadKnowledgeDocument,
}))
vi.mock('@/lib/knowledge/orchestration/documents', () => ({
  findBoundKnowledgeDocument: mockFindBoundKnowledgeDocument,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mockDeleteFileMetadata,
  recordKnowledgeBaseFileOwnership: mockRecordKnowledgeBaseFileOwnership,
}))

import { finalizeKnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const CLAIMED = {
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
  metadata: { tag1: 'product', processingOptions: { recipe: 'default', lang: 'en' } },
  uploadToken: 'token',
  createdAt: new Date('2026-08-03T21:00:00.000Z'),
  expiresAt: new Date('2026-08-04T21:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: new Date('2026-08-03T21:00:00.000Z'),
  // biome-ignore lint/suspicious/noExplicitAny: partial session shape for the test
} as any
const DOCUMENT = { id: 'upload-1', knowledgeBaseId: 'kb-1', filename: 'guide.pdf' }

function finalize(resolveAttribution = vi.fn().mockResolvedValue({ actorUserId: 'payer-1' })) {
  return finalizeKnowledgeDocumentUpload({
    claimed: CLAIMED,
    knowledgeBaseId: 'kb-1',
    knowledgeBaseName: 'Docs',
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    resolveAttribution,
    source: 'api',
    requestId: 'req-1',
    request: new NextRequest('http://localhost:3000/api/v2/knowledge/kb-1'),
  })
}

describe('finalizeKnowledgeDocumentUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'absent' })
    mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
    mockDeleteFile.mockResolvedValue(undefined)
    mockDeleteFileMetadata.mockResolvedValue(true)
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: true,
      document: DOCUMENT,
      created: true,
    })
  })

  it('creates the document, carrying session tags and processing options through', async () => {
    const result = await finalize()

    expect(result).toEqual({ value: DOCUMENT, completedFileId: 'upload-1' })
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
        processingOptions: { recipe: 'default', lang: 'en' },
        document: expect.objectContaining({ filename: 'guide.pdf', tag1: 'product' }),
      })
    )
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('answers a retry from the bound document without resolving a payer', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'bound', document: DOCUMENT })
    const resolveAttribution = vi.fn()

    const result = await finalize(resolveAttribution)

    expect(result).toEqual({ value: DOCUMENT, completedFileId: 'upload-1' })
    expect(resolveAttribution).not.toHaveBeenCalled()
    expect(mockRecordKnowledgeBaseFileOwnership).not.toHaveBeenCalled()
    expect(mockPerformUploadKnowledgeDocument).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('deletes the uploaded object when creation fails and nothing is bound', async () => {
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: false,
      errorCode: 'payload_too_large',
      error: 'Storage limit exceeded',
    })

    await expect(finalize()).rejects.toThrow('Storage limit exceeded')
    expect(mockDeleteFile).toHaveBeenCalledWith({ key: 'kb/guide.pdf', context: 'knowledge-base' })
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/guide.pdf')
  })

  it('keeps the uploaded object when a document is bound despite the failure', async () => {
    mockFindBoundKnowledgeDocument
      .mockResolvedValueOnce({ status: 'absent' })
      .mockResolvedValueOnce({ status: 'bound', document: DOCUMENT })
    mockPerformUploadKnowledgeDocument.mockRejectedValue(new Error('audit sink exploded'))

    await expect(finalize()).rejects.toThrow('audit sink exploded')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })

  it('rejects an upload id already bound to a different document without deleting anything', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'conflict' })
    const resolveAttribution = vi.fn()

    await expect(finalize(resolveAttribution)).rejects.toThrow(
      'Upload id is already bound to a different document'
    )
    expect(resolveAttribution).not.toHaveBeenCalled()
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })
})
