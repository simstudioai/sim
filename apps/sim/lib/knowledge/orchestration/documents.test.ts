/**
 * @vitest-environment node
 */
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
  performDeleteKnowledgeDocument,
  performMarkKnowledgeDocumentTimedOut,
  performRetryKnowledgeDocumentProcessing,
  performUpdateKnowledgeDocument,
  performUploadKnowledgeDocument,
  performUploadKnowledgeDocuments,
} from '@/lib/knowledge/orchestration/documents'

const KB = { id: 'kb-1', name: 'Docs', workspaceId: 'ws-1' }
const FILE = {
  filename: 'report.pdf',
  fileUrl: 'https://storage/report.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
}
const ACTOR = { userId: 'user-1', source: 'agent' as const, requestId: 'req-1' }

describe('performUploadKnowledgeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSingleDocument.mockResolvedValue({ id: 'doc-1', filename: 'report.pdf' })
    mockGetDocumentByUploadId.mockResolvedValue(null)
    mockProcessDocumentsWithQueue.mockResolvedValue(undefined)
    mockProcessDocumentAsync.mockResolvedValue(undefined)
  })

  it('audits an agent upload, which the copilot path never did', async () => {
    const outcome = await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        resourceId: 'doc-1',
        resourceName: 'report.pdf',
        metadata: expect.objectContaining({ source: 'agent', knowledgeBaseId: 'kb-1' }),
      })
    )
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

  it('starts no indexing unless the caller asks for it', async () => {
    await performUploadKnowledgeDocument({ ...ACTOR, knowledgeBase: KB, document: FILE })

    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
    expect(mockProcessDocumentAsync).not.toHaveBeenCalled()
  })

  it.each([
    { startProcessing: 'queue' as const, expected: mockProcessDocumentsWithQueue },
    { startProcessing: 'async' as const, expected: mockProcessDocumentAsync },
  ])('hands the record to the $startProcessing pipeline', async ({ startProcessing, expected }) => {
    await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
      startProcessing,
    })

    expect(expected).toHaveBeenCalled()
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

  it('returns the authoritative upload without legacy audit or product analytics when disabled', async () => {
    const outcome = await performUploadKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: FILE,
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })

    expect(outcome).toMatchObject({ success: true, document: { id: 'doc-1' } })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockPlatformUpload).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
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

describe('performUploadKnowledgeDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateDocumentRecords.mockResolvedValue([
      { documentId: 'doc-1', filename: 'a.pdf' },
      { documentId: 'doc-2', filename: 'b.pdf' },
    ])
    mockProcessDocumentsWithQueue.mockResolvedValue(undefined)
  })

  it('admits the whole batch in one call and queues it', async () => {
    const outcome = await performUploadKnowledgeDocuments({
      ...ACTOR,
      knowledgeBase: KB,
      documents: [FILE, { ...FILE, filename: 'b.pdf' }],
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockCreateDocumentRecords).toHaveBeenCalledTimes(1)
    expect(mockProcessDocumentsWithQueue).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceName: '2 document(s)' })
    )
  })

  it('rejects an empty batch before touching the service', async () => {
    const outcome = await performUploadKnowledgeDocuments({
      ...ACTOR,
      knowledgeBase: KB,
      documents: [],
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockCreateDocumentRecords).not.toHaveBeenCalled()
  })

  it('returns the authoritative batch without legacy audit or product analytics when disabled', async () => {
    const outcome = await performUploadKnowledgeDocuments({
      ...ACTOR,
      knowledgeBase: KB,
      documents: [FILE],
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })

    expect(outcome).toMatchObject({ success: true })
    expect(outcome.success && outcome.documents[0]).toMatchObject({ documentId: 'doc-1' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockPlatformUpload).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDocument.mockResolvedValue({ id: 'doc-1', filename: 'renamed.pdf' })
  })

  it('rejects an update that names nothing before touching the service', async () => {
    const outcome = await performUpdateKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: { id: 'doc-1', filename: 'report.pdf' },
      updates: { filename: undefined, enabled: undefined },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })

  it('names the changed fields in the audit metadata', async () => {
    await performUpdateKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: { id: 'doc-1', filename: 'report.pdf' },
      updates: { filename: 'renamed.pdf', enabled: false },
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'renamed.pdf',
        metadata: expect.objectContaining({
          updatedFields: ['filename', 'enabled'],
          enabled: false,
        }),
      })
    )
  })
})

describe('performDeleteKnowledgeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteDocument.mockResolvedValue({ success: true, message: 'ok' })
  })

  it('audits the deletion against the acting user', async () => {
    const outcome = await performDeleteKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: { id: 'doc-1', filename: 'report.pdf', fileSize: 10, mimeType: 'application/pdf' },
    })

    expect(outcome).toMatchObject({ success: true })
    expect(mockDeleteDocument).toHaveBeenCalledWith('doc-1', 'req-1')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1', resourceId: 'doc-1' })
    )
    expect(mockCaptureServerEvent).toHaveBeenCalled()
  })

  it('emits no telemetry when the delete fails', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('deadlock detected'))

    const outcome = await performDeleteKnowledgeDocument({
      ...ACTOR,
      knowledgeBase: KB,
      document: { id: 'doc-1', filename: 'report.pdf' },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('document processing state changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkDocumentAsFailedTimeout.mockResolvedValue({
      success: true,
      processingDuration: 600_001,
    })
  })

  it('refuses to time out a document that is not processing', async () => {
    const outcome = await performMarkKnowledgeDocumentTimedOut({
      document: { id: 'doc-1', processingStatus: 'completed', processingStartedAt: new Date() },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockMarkDocumentAsFailedTimeout).not.toHaveBeenCalled()
  })

  it('refuses to time out a document with no processing start time', async () => {
    const outcome = await performMarkKnowledgeDocumentTimedOut({
      document: { id: 'doc-1', processingStatus: 'processing', processingStartedAt: null },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
  })

  it('surfaces a too-soon timeout as caller-fixable, not a fault', async () => {
    mockMarkDocumentAsFailedTimeout.mockRejectedValue(
      new Error('Document has not been processing long enough to be considered dead')
    )

    const outcome = await performMarkKnowledgeDocumentTimedOut({
      document: { id: 'doc-1', processingStatus: 'processing', processingStartedAt: new Date() },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
  })

  it('reports a conflict when the processing claim changes before the timeout write', async () => {
    mockMarkDocumentAsFailedTimeout.mockResolvedValue({
      success: false,
      processingDuration: 600_001,
    })

    const outcome = await performMarkKnowledgeDocumentTimedOut({
      document: { id: 'doc-1', processingStatus: 'processing', processingStartedAt: new Date() },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('refuses to retry a document that has not failed', async () => {
    const outcome = await performRetryKnowledgeDocumentProcessing({
      knowledgeBaseId: 'kb-1',
      document: { ...FILE, id: 'doc-1', processingStatus: 'completed' },
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'validation' })
    expect(mockRetryDocumentProcessing).not.toHaveBeenCalled()
  })

  it('re-queues a failed document and never audits it', async () => {
    mockRetryDocumentProcessing.mockResolvedValue({
      success: true,
      status: 'pending',
      message: 'Document retry processing started',
    })

    const outcome = await performRetryKnowledgeDocumentProcessing({
      knowledgeBaseId: 'kb-1',
      document: { ...FILE, id: 'doc-1', processingStatus: 'failed' },
      requestId: 'req-1',
    })

    expect(outcome).toMatchObject({ success: true, status: 'pending' })
    // No document state the user chose changes, so there is nothing to record.
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
