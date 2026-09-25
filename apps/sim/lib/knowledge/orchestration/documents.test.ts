import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCaptureServerEvent,
  mockCreateDocumentRecords,
  mockCreateSingleDocument,
  mockDeleteDocument,
  mockGetDocumentByUploadId,
  mockMarkDocumentAsFailedTimeout,
  mockProcessDocumentAsync,
  mockProcessDocumentsWithQueue,
  mockPlatformUpload,
  mockRecordAudit,
  mockRetryDocumentProcessing,
  mockUpdateDocument,
} = vi.hoisted(() => ({
  mockCaptureServerEvent: vi.fn(),
  mockCreateDocumentRecords: vi.fn(),
  mockCreateSingleDocument: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockGetDocumentByUploadId: vi.fn(),
  mockMarkDocumentAsFailedTimeout: vi.fn(),
  mockProcessDocumentAsync: vi.fn(),
  mockProcessDocumentsWithQueue: vi.fn(),
  mockPlatformUpload: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockRetryDocumentProcessing: vi.fn(),
  mockUpdateDocument: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    DOCUMENT_UPLOADED: 'document.uploaded',
    DOCUMENT_UPDATED: 'document.updated',
    DOCUMENT_DELETED: 'document.deleted',
  },
  AuditResourceType: { DOCUMENT: 'document' },
  recordAudit: mockRecordAudit,
}))
vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { knowledgeBaseDocumentsUploaded: mockPlatformUpload },
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  createDocumentRecords: mockCreateDocumentRecords,
  createSingleDocument: mockCreateSingleDocument,
  deleteDocument: mockDeleteDocument,
  getDocumentByUploadId: mockGetDocumentByUploadId,
  markDocumentAsFailedTimeout: mockMarkDocumentAsFailedTimeout,
  processDocumentAsync: mockProcessDocumentAsync,
  processDocumentsWithQueue: mockProcessDocumentsWithQueue,
  retryDocumentProcessing: mockRetryDocumentProcessing,
  updateDocument: mockUpdateDocument,
}))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: mockCaptureServerEvent }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performMarkKnowledgeDocumentTimedOut,
  performRetryKnowledgeDocumentProcessing,
  performUploadKnowledgeDocument,
} from '@/lib/knowledge/orchestration/documents'

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const FILE = {
  filename: 'report.pdf',
  fileUrl: 'https://storage/report.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
}
const ACTOR = { userId: 'user-1', source: 'agent' as const, requestId: 'req-1' }

/**
 * Lets the fire-and-forget dispatch settle. Both upload paths queue indexing
 * after their response is decided, so the unwind runs on a later microtask.
 */
async function _settleDispatch(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** The `document` write that records a dispatch that never got off the ground. */
function _undispatchedFailureWrites(): Record<string, unknown>[] {
  return dbChainMockFns.set.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((values) => values?.processingStatus === 'failed')
}

describe('performUploadKnowledgeDocument', () => {
  beforeEach(() => {
    mockCreateSingleDocument.mockResolvedValue({ id: 'doc-1', filename: 'report.pdf' })
    mockGetDocumentByUploadId.mockResolvedValue(null)
    mockProcessDocumentsWithQueue.mockResolvedValue(undefined)
    mockProcessDocumentAsync.mockResolvedValue(undefined)
    resetDbChainMock()
  })

  it('records the document owner the caller names, not the acting user', async () => {
    // A workspace API key bills and owns as the workspace account, while the
    // acting user stays the audit actor.
    await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
      uploadedBy: 'workspace-owner',
    })

    expect(mockCreateSingleDocument).toHaveBeenCalledWith(
      FILE,
      'kb-1',
      'req-1',
      'workspace-owner',
      undefined,
      undefined
    )
  })

  it('classifies a storage-quota rejection as too large, by class not message', async () => {
    mockCreateSingleDocument.mockRejectedValue(
      new OrchestrationError('payload_too_large', 'Storage limit exceeded. Used: 5.10GB')
    )

    const outcome = await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'payload_too_large' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('classifies a foreign file reference as forbidden', async () => {
    mockCreateSingleDocument.mockRejectedValue(
      new OrchestrationError('forbidden', 'Document file is not owned by this knowledge base')
    )

    expect(
      (await performUploadKnowledgeDocument({ ...ACTOR, knowledgeBase: KB, document: FILE }))
        .errorCode
    ).toBe('forbidden')
  })

  it('returns the document already bound to a stateless upload id without duplicating work', async () => {
    const existing = {
      id: 'upload-1',
      knowledgeBaseId: 'kb-1',
      filename: FILE.filename,
      fileUrl: FILE.fileUrl,
      fileSize: FILE.fileSize,
      mimeType: FILE.mimeType,
      chunkCount: 0,
      tokenCount: 0,
      characterCount: 0,
      enabled: true,
      uploadedAt: new Date(),
    }
    mockGetDocumentByUploadId.mockResolvedValue(existing)

    const outcome = await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
      documentId: 'upload-1',
      startProcessing: 'queue',
    })

    expect(outcome).toMatchObject({ success: true, created: false, document: existing })
    expect(mockCreateSingleDocument).not.toHaveBeenCalled()
    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('converges on the existing document when concurrent completions race to insert', async () => {
    const existing = {
      id: 'upload-1',
      knowledgeBaseId: 'kb-1',
      ...FILE,
      chunkCount: 0,
      tokenCount: 0,
      characterCount: 0,
      enabled: true,
      uploadedAt: new Date(),
      processingStatus: 'pending',
    }
    mockGetDocumentByUploadId.mockResolvedValueOnce(null).mockResolvedValueOnce(existing)
    mockCreateSingleDocument.mockRejectedValue(new Error('duplicate key'))

    const outcome = await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
      documentId: 'upload-1',
      startProcessing: 'queue',
    })

    expect(outcome).toMatchObject({ success: true, created: false, document: existing })
    expect(mockCreateSingleDocument).toHaveBeenCalledWith(
      FILE,
      'kb-1',
      'req-1',
      'user-1',
      'upload-1',
      undefined
    )
    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})

describe('document processing state changes', () => {
  beforeEach(() => {
    mockMarkDocumentAsFailedTimeout.mockResolvedValue({
      success: true,
      processingDuration: 600_001,
    })
  })

  it('refuses to time out a document that is not processing', async () => {
    const outcome = await performMarkKnowledgeDocumentTimedOut({
      knowledgeBaseId: 'kb-1',
      document: { id: 'doc-1', processingStatus: 'completed', processingStartedAt: new Date() },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockMarkDocumentAsFailedTimeout).not.toHaveBeenCalled()
  })

  it('reports a conflict when the processing claim changes before the timeout write', async () => {
    mockMarkDocumentAsFailedTimeout.mockResolvedValue({
      success: false,
      processingDuration: 600_001,
    })

    const outcome = await performMarkKnowledgeDocumentTimedOut({
      knowledgeBaseId: 'kb-1',
      document: { id: 'doc-1', processingStatus: 'processing', processingStartedAt: new Date() },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('requires source refresh for missing source content while allowing a manual upload with no hash', async () => {
    const document = { ...FILE, id: 'doc-1', processingStatus: 'failed', contentHash: null }
    const blocked = await performRetryKnowledgeDocumentProcessing({
      knowledgeBaseId: 'kb-1',
      document: { ...document, connectorId: 'connector' },
    })
    expect(blocked).toMatchObject({
      success: false,
      errorCode: 'validation',
      error: expect.stringContaining('Sync the connector'),
    })
    expect(mockRetryDocumentProcessing).not.toHaveBeenCalled()
    mockRetryDocumentProcessing.mockResolvedValue({
      success: true,
      status: 'pending',
      message: 'Retry started',
    })
    expect(
      await performRetryKnowledgeDocumentProcessing({
        knowledgeBaseId: 'kb-1',
        document: { ...document, connectorId: null },
      })
    ).toMatchObject({ success: true })
    expect(mockRetryDocumentProcessing).toHaveBeenCalledOnce()
  })
})
