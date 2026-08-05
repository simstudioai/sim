/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

const {
  mockAbortUploadSession,
  mockCreateUploadSession,
  mockFindBoundKnowledgeDocument,
  mockPerformUploadKnowledgeDocument,
  mockRecordKnowledgeBaseFileOwnership,
} = vi.hoisted(() => ({
  mockAbortUploadSession: vi.fn(),
  mockCreateUploadSession: vi.fn(),
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
vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: mockAbortUploadSession,
  createUploadSession: mockCreateUploadSession,
  getOwnedUploadSession: vi.fn(),
}))
vi.mock('@/lib/uploads/server/metadata', () => ({
  recordKnowledgeBaseFileOwnership: mockRecordKnowledgeBaseFileOwnership,
}))

import {
  abortKnowledgeDocumentUpload,
  createKnowledgeDocumentUploadSession,
  finalizeKnowledgeDocumentUpload,
  toV2KnowledgeDocumentUpload,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const CLAIMED: UploadSessionRecord = {
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
  metadata: { tag1: 'product', processingOptions: { recipe: 'default', lang: 'en' } },
  uploadToken: 'token',
  createdAt: new Date('2026-08-03T21:00:00.000Z'),
  expiresAt: new Date('2026-08-04T21:00:00.000Z'),
  completedFileId: null,
  error: null,
  completedAt: null,
  updatedAt: new Date('2026-08-03T21:00:00.000Z'),
}
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

function createSession() {
  return createKnowledgeDocumentUploadSession({
    workspaceId: WORKSPACE_ID,
    userId: 'user-1',
    knowledgeBaseId: 'kb-1',
    fileName: 'guide.pdf',
    contentType: 'application/pdf',
    fileSize: 1024,
    metadata: { tag1: 'product' },
    localOrigin: 'http://localhost:3000',
  })
}

describe('createKnowledgeDocumentUploadSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateUploadSession.mockResolvedValue(CLAIMED)
    mockRecordKnowledgeBaseFileOwnership.mockResolvedValue(undefined)
    mockAbortUploadSession.mockResolvedValue({ ...CLAIMED, status: 'aborted' })
  })

  it('records the ownership binding before returning the upload token', async () => {
    await expect(createSession()).resolves.toBe(CLAIMED)

    expect(mockCreateUploadSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userId: 'user-1',
      knowledgeBaseId: 'kb-1',
      purpose: 'knowledge_document',
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      metadata: { tag1: 'product' },
      localOrigin: 'http://localhost:3000',
    })
    expect(mockRecordKnowledgeBaseFileOwnership).toHaveBeenCalledWith({
      key: 'kb/guide.pdf',
      userId: 'user-1',
      workspaceId: WORKSPACE_ID,
      originalName: 'guide.pdf',
      contentType: 'application/pdf',
      size: 1024,
    })
    expect(mockCreateUploadSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecordKnowledgeBaseFileOwnership.mock.invocationCallOrder[0]
    )
  })

  it('aborts provider state when the ownership binding cannot be recorded', async () => {
    mockRecordKnowledgeBaseFileOwnership.mockRejectedValue(new Error('database unavailable'))

    await expect(createSession()).rejects.toThrow('database unavailable')
    expect(mockAbortUploadSession).toHaveBeenCalledWith(CLAIMED)
  })
})

describe('toV2KnowledgeDocumentUpload', () => {
  it('does not expose reusable upload capabilities after session creation', () => {
    const serialized = toV2KnowledgeDocumentUpload(CLAIMED, null)

    expect(serialized).not.toHaveProperty('uploadToken')
    expect(serialized).not.toHaveProperty('partSize')
    expect(serialized).not.toHaveProperty('partCount')
    expect(serialized).not.toHaveProperty('transfer')
  })
})

describe('abortKnowledgeDocumentUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAbortUploadSession.mockResolvedValue({ ...CLAIMED, status: 'aborted' })
  })

  it('aborts an upload that no document is bound to', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'absent' })

    await expect(abortKnowledgeDocumentUpload(CLAIMED, 'kb-1')).resolves.toMatchObject({
      status: 'aborted',
    })
    expect(mockAbortUploadSession).toHaveBeenCalledWith(CLAIMED)
  })

  it('refuses to abort once a document is bound, so committed bytes survive', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'bound', document: DOCUMENT })

    await expect(abortKnowledgeDocumentUpload(CLAIMED, 'kb-1')).rejects.toThrow(
      'Upload has already been completed'
    )
    expect(mockAbortUploadSession).not.toHaveBeenCalled()
  })
})

describe('finalizeKnowledgeDocumentUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'absent' })
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: true,
      document: DOCUMENT,
      created: true,
    })
  })

  it('creates the document, carrying session tags and processing options through', async () => {
    const result = await finalize()

    expect(result).toEqual({ value: DOCUMENT, completedFileId: 'upload-1' })
    expect(mockPerformUploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'upload-1',
        startProcessing: 'queue',
        uploadedBy: 'payer-1',
        processingOptions: { recipe: 'default', lang: 'en' },
        document: expect.objectContaining({ filename: 'guide.pdf', tag1: 'product' }),
      })
    )
  })

  it('answers a retry from the bound document without resolving a payer', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'bound', document: DOCUMENT })
    const resolveAttribution = vi.fn()

    const result = await finalize(resolveAttribution)

    expect(result).toEqual({ value: DOCUMENT, completedFileId: 'upload-1' })
    expect(resolveAttribution).not.toHaveBeenCalled()
    expect(mockPerformUploadKnowledgeDocument).not.toHaveBeenCalled()
  })

  it('retains completed bytes for retry when document creation fails', async () => {
    mockPerformUploadKnowledgeDocument.mockResolvedValue({
      success: false,
      errorCode: 'payload_too_large',
      error: 'Storage limit exceeded',
    })

    await expect(finalize()).rejects.toThrow('Storage limit exceeded')
    expect(mockFindBoundKnowledgeDocument).toHaveBeenCalledTimes(1)
  })

  it('lets a retry converge when the first response fails after the document binds', async () => {
    mockFindBoundKnowledgeDocument
      .mockResolvedValueOnce({ status: 'absent' })
      .mockResolvedValueOnce({ status: 'bound', document: DOCUMENT })
    mockPerformUploadKnowledgeDocument.mockRejectedValue(new Error('audit sink exploded'))

    await expect(finalize()).rejects.toThrow('audit sink exploded')
    await expect(finalize()).resolves.toEqual({
      value: DOCUMENT,
      completedFileId: 'upload-1',
    })
    expect(mockPerformUploadKnowledgeDocument).toHaveBeenCalledTimes(1)
  })

  it('rejects an upload id already bound to a different document without deleting anything', async () => {
    mockFindBoundKnowledgeDocument.mockResolvedValue({ status: 'conflict' })
    const resolveAttribution = vi.fn()

    await expect(finalize(resolveAttribution)).rejects.toThrow(
      'Upload id is already bound to a different document'
    )
    expect(resolveAttribution).not.toHaveBeenCalled()
  })
})
