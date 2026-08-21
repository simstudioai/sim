/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckActorUsageLimits,
  mockGenerateEmbeddings,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetFileMetadataByKeys,
  mockProcessDocument,
} = vi.hoisted(() => ({
  mockCheckActorUsageLimits: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockProcessDocument: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: mockProcessDocument,
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  getEmbeddingModelInfo: vi.fn(() => ({ tokenizerProvider: 'openai' })),
}))

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateEmbeddings: mockGenerateEmbeddings,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  getBoundWorkspaceFileSecretProvenanceByMetadata:
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadataByIdentity: vi.fn(),
  getFileMetadataByKeys: mockGetFileMetadataByKeys,
}))

import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const PERSISTED_KEY = 'workspace/workspace-1/persisted.pdf'
const PERSISTED_URL = `/api/files/serve/${encodeURIComponent(PERSISTED_KEY)}?context=workspace`
const CONTENT_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')

const PERSISTED_CONTEXT = {
  workspaceId: null,
  knowledgeBaseUserId: 'knowledge-owner',
  chunkingConfig: null,
  embeddingModel: 'text-embedding-3-small',
  billedAccountUserId: null,
  uploadedBy: 'uploader-1',
  filename: 'persisted.pdf',
  fileUrl: PERSISTED_URL,
  fileSize: 512,
  mimeType: 'application/pdf',
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  number1: null,
  number2: null,
  number3: null,
  number4: null,
  number5: null,
  date1: null,
  date2: null,
  boolean1: null,
  boolean2: null,
  boolean3: null,
}

const PERSISTED_PROVENANCE_ROW = {
  id: 'document-1',
  secretProvenanceVersion: null,
  filename: PERSISTED_CONTEXT.filename,
  fileUrl: PERSISTED_CONTEXT.fileUrl,
  contentHash: null,
  sourceUrl: null,
  tag1: null,
  tag2: null,
  tag3: null,
  tag4: null,
  tag5: null,
  tag6: null,
  tag7: null,
  number1: null,
  number2: null,
  number3: null,
  number4: null,
  number5: null,
  date1: null,
  date2: null,
  boolean1: null,
  boolean2: null,
  boolean3: null,
  provenanceSourceHash: null,
  status: null,
  entries: null,
}

const SOURCE_BINDING = {
  id: 'source-file-1',
  key: PERSISTED_KEY,
  userId: 'uploader-1',
  workspaceId: 'workspace-1',
  context: 'workspace',
  originalName: PERSISTED_CONTEXT.filename,
  displayName: PERSISTED_CONTEXT.filename,
  contentType: PERSISTED_CONTEXT.mimeType,
  size: PERSISTED_CONTEXT.fileSize,
  folderId: null,
  uploadedAt: CONTENT_UPDATED_AT,
  contentUpdatedAt: CONTENT_UPDATED_AT,
  deletedAt: null,
  secretProvenanceVersion: null,
}

describe('knowledge document processing source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'workspace' ? [SOURCE_BINDING] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockResolvedValue({
      chunks: [],
      metadata: { chunkCount: 0, tokenCount: 0, characterCount: 0 },
    })
  })

  it('uses the persisted document source instead of stale queued source fields', async () => {
    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'stale.pdf',
      fileUrl: 'https://example.com/stale.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockGetFileMetadataByKeys).toHaveBeenCalledWith(
      [PERSISTED_KEY],
      'workspace',
      expect.anything()
    )
    expect(mockGetBoundWorkspaceFileSecretProvenanceByMetadata).toHaveBeenCalledWith(
      expect.anything(),
      [SOURCE_BINDING]
    )
    expect(mockProcessDocument).toHaveBeenCalledWith(
      PERSISTED_CONTEXT.fileUrl,
      PERSISTED_CONTEXT.filename,
      PERSISTED_CONTEXT.mimeType,
      1024,
      200,
      100,
      PERSISTED_CONTEXT.uploadedBy,
      null,
      undefined,
      undefined
    )
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('processes a legacy document when its workspace metadata row no longer exists', async () => {
    mockGetFileMetadataByKeys.mockResolvedValue([])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(new Map())

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'stale.pdf',
      fileUrl: 'https://example.com/stale.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockProcessDocument).toHaveBeenCalledWith(
      PERSISTED_CONTEXT.fileUrl,
      PERSISTED_CONTEXT.filename,
      PERSISTED_CONTEXT.mimeType,
      1024,
      200,
      100,
      PERSISTED_CONTEXT.uploadedBy,
      null,
      undefined,
      undefined
    )
  })

  it('fails before parsing an existing document when its current source is tracked unknown', async () => {
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'workspace' ? [{ ...SOURCE_BINDING, secretProvenanceVersion: 1 }] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'unknown' }]])
    )

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'stale.pdf',
        fileUrl: 'https://example.com/stale.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      })
    ).rejects.toThrow('Knowledge document secret provenance is unavailable')

    expect(mockProcessDocument).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('takes over an existing processing attempt', async () => {
    dbChainMockFns.limit
      .mockReset()
      .mockResolvedValueOnce([{ ...PERSISTED_CONTEXT, processingStatus: 'processing' }])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    dbChainMockFns.returning.mockReset().mockResolvedValue([{ id: 'document-1' }])

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'stale.pdf',
      fileUrl: 'https://example.com/stale.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockProcessDocument).toHaveBeenCalled()
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: 'processing',
        processingStartedAt: expect.any(Date),
      })
    )
  })
})

describe('processDocumentAsync write guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockProcessDocument.mockResolvedValue({
      chunks: [],
      metadata: { chunkCount: 0, tokenCount: 0, characterCount: 0 },
    })
  })

  /** Asserts the write that set `status` exists, and returns its guard clause. */
  function guardForStatusWrite(status: string): unknown {
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === status
      )
    ).toBe(true)

    // `set` and `where` are separate shared spies, so they cannot be correlated
    // by index; the guard is identified by its own shape instead.
    const guard = dbChainMockFns.where.mock.calls.find((call) =>
      hasMockCondition(
        call[0],
        (node: MockCondition) =>
          node.type === 'ne' &&
          node.left === schemaMock.document.processingStatus &&
          node.right === 'completed'
      )
    )
    expect(guard).toBeDefined()
    return guard?.[0]
  }

  it('never claims a document whose pass already completed', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'a.pdf',
      fileUrl: 'https://example.com/a.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    /**
     * Unguarded, a late or duplicate dispatch flipped `completed` back to
     * `processing`, discarding a pass that had already indexed and billed.
     */
    expect(guardForStatusWrite('processing')).toBeDefined()
  })

  it('does not process or bill a document it failed to claim', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    // The guarded claim matched no rows: another pass owns this document.
    dbChainMockFns.returning.mockReset().mockResolvedValue([])

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'a.pdf',
      fileUrl: 'https://example.com/a.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    expect(mockProcessDocument).not.toHaveBeenCalled()
  })

  it('guards the missing-context failure write against a finished pass', async () => {
    // No context row: the document or its knowledge base is gone.
    dbChainMockFns.limit.mockResolvedValue([])

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'a.pdf',
      fileUrl: 'https://example.com/a.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    const where = guardForStatusWrite('failed')
    for (const column of [schemaMock.document.archivedAt, schemaMock.document.deletedAt]) {
      expect(
        hasMockCondition(
          where,
          (node: MockCondition) => node.type === 'isNull' && node.column === column
        )
      ).toBe(true)
    }
  })

  it('clears the retry budget when a pass completes', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: 'a.pdf',
      fileUrl: 'https://example.com/a.pdf',
      fileSize: 1,
      mimeType: 'text/plain',
    })

    /**
     * Without the reset a document that failed four times and then succeeded
     * would carry those attempts forever, so its next single failure would
     * exhaust the budget and dead-letter a document that is actually healthy.
     */
    const completion = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'completed'
    )
    expect(completion).toBeDefined()
    expect((completion?.[0] as Record<string, unknown>).processingAttempts).toBe(0)
  })
})
