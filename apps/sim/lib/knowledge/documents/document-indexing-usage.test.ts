/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCalculateCost,
  mockCheckActorUsageLimits,
  mockCheckAndBillOverageThreshold,
  mockGenerateEmbeddings,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetFileMetadataByKeys,
  mockProcessDocument,
  mockRecordUsage,
} = vi.hoisted(() => ({
  mockCalculateCost: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockCheckAndBillOverageThreshold: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockProcessDocument: vi.fn(),
  mockRecordUsage: vi.fn(),
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/billing/core/usage-log', () => ({
  recordUsage: mockRecordUsage,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: mockCheckAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: mockProcessDocument,
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  MAX_KB_EMBEDDING_DIMENSIONS: 3072,
  toKbEmbeddingDimensions: (value: number) => value,
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

vi.mock('@/providers/utils', () => ({
  calculateCost: mockCalculateCost,
}))

import * as embeddingClient from '@/lib/embeddings/client'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'

const mockEmbeddingCapacity = vi.fn<typeof embeddingClient.assertKnowledgeEmbeddingCapacity>()
beforeEach(() => {
  mockEmbeddingCapacity.mockReset().mockResolvedValue(undefined)
  vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockImplementation(
    mockEmbeddingCapacity
  )
})

const DOCUMENT_ID = 'document-1'
const KNOWLEDGE_BASE_ID = 'knowledge-base-1'
const PERSISTED_KEY = 'workspace/workspace-1/persisted.pdf'
const PERSISTED_URL = `/api/files/serve/${encodeURIComponent(PERSISTED_KEY)}?context=workspace`
const CONTENT_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')

const PERSISTED_CONTEXT = {
  workspaceId: null,
  knowledgeBaseUserId: 'knowledge-owner',
  chunkingConfig: null,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimension: 1536,
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
  id: DOCUMENT_ID,
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

const DOC_DATA = {
  filename: PERSISTED_CONTEXT.filename,
  fileUrl: PERSISTED_CONTEXT.fileUrl,
  fileSize: PERSISTED_CONTEXT.fileSize,
  mimeType: PERSISTED_CONTEXT.mimeType,
}

/**
 * Re-arms the row sets one `processDocumentAsync` call consumes: the KB/document
 * context JOIN, the document secret-provenance row, and the in-transaction claim
 * re-check that lets the attempt commit.
 */
function armDocumentReads(): void {
  dbChainMockFns.limit
    .mockResolvedValueOnce([PERSISTED_CONTEXT])
    .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
    .mockResolvedValueOnce([{ id: DOCUMENT_ID }])
}

/** The `sourceReference` of the single embedding charge recorded by call `index`. */
function recordedSourceReference(index: number): string {
  return mockRecordUsage.mock.calls[index][0].entries[0].sourceReference
}

describe('knowledge document indexing usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
      context === 'workspace' ? [SOURCE_BINDING] : []
    )
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockResolvedValue({
      chunks: [{ text: 'chunk text', metadata: { startIndex: 0, endIndex: 10 } }],
      metadata: { chunkCount: 1, tokenCount: 4, characterCount: 10 },
    })
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      billableTokens: 128,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    })
    mockCalculateCost.mockReturnValue({ total: 0.25 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts a timed-out parse and never embeds its late result', async () => {
    vi.useFakeTimers()
    armDocumentReads()
    let finishParse: ((value: unknown) => void) | undefined
    mockProcessDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishParse = resolve
        })
    )
    const pending = processDocumentAsync(
      KNOWLEDGE_BASE_ID,
      DOCUMENT_ID,
      DOC_DATA,
      {},
      undefined,
      'timeout-pass'
    )
    const rejected = expect(pending).rejects.toThrow('Document processing timed out')
    await vi.advanceTimersByTimeAsync(0)
    const signal = mockProcessDocument.mock.calls[0][6].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(600_001)
    await rejected
    expect(signal.aborted).toBe(true)
    finishParse?.({ chunks: [{ text: 'late text', metadata: {} }], metadata: {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('aborts in-flight embeddings when the document deadline expires', async () => {
    vi.useFakeTimers()
    armDocumentReads()
    mockGenerateEmbeddings.mockImplementationOnce(
      (_texts, _model, _workspace, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
    )
    const pending = processDocumentAsync(
      KNOWLEDGE_BASE_ID,
      DOCUMENT_ID,
      DOC_DATA,
      {},
      undefined,
      'timeout-pass'
    )
    const rejected = expect(pending).rejects.toThrow('Document processing timed out')
    await vi.advanceTimersByTimeAsync(0)
    const signal = mockGenerateEmbeddings.mock.calls[0][3] as AbortSignal
    expect(signal).toBe(mockProcessDocument.mock.calls[0][6].signal)
    await vi.advanceTimersByTimeAsync(600_001)
    await rejected
    expect(signal.aborted).toBe(true)
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('records one embedding charge per indexing pass', async () => {
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {}, undefined, 'pass-1')

    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(recordedSourceReference(0)).toBe(`knowledge-document:${DOCUMENT_ID}:pass-1`)
  })

  it('reuses the same usage source reference across attempts of one indexing pass', async () => {
    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(1_000)
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {}, undefined, 'pass-1')

    nowSpy.mockReturnValue(9_000)
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {}, undefined, 'pass-1')

    nowSpy.mockRestore()

    expect(mockRecordUsage).toHaveBeenCalledTimes(2)
    expect(recordedSourceReference(1)).toBe(recordedSourceReference(0))
  })

  it('uses a distinct usage source reference for a genuinely new indexing pass', async () => {
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {}, undefined, 'pass-1')

    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {}, undefined, 'pass-2')

    expect(mockRecordUsage).toHaveBeenCalledTimes(2)
    expect(recordedSourceReference(1)).not.toBe(recordedSourceReference(0))
  })

  it('falls back to a pricing-scoped reference that is still stable across attempts', async () => {
    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(1_000)
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {})

    nowSpy.mockReturnValue(9_000)
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {})

    nowSpy.mockRestore()

    expect(recordedSourceReference(0)).toBe(
      `knowledge-document:${DOCUMENT_ID}:model:text-embedding-3-small`
    )
    expect(recordedSourceReference(1)).toBe(recordedSourceReference(0))
  })

  it('re-bills the fallback reference when the embedding model changes', async () => {
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {})

    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.3, 0.4]],
      billableTokens: 128,
      modelName: 'text-embedding-3-large',
      pricingId: 'text-embedding-3-large',
    })
    armDocumentReads()
    await processDocumentAsync(KNOWLEDGE_BASE_ID, DOCUMENT_ID, DOC_DATA, {})

    expect(recordedSourceReference(1)).not.toBe(recordedSourceReference(0))
  })
})
