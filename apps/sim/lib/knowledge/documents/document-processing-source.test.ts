/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  defaultMockEnv,
  hasMockCondition,
  type MockCondition,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckActorUsageLimits,
  mockBatchTrigger,
  mockGenerateEmbeddings,
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata,
  mockGetEmbeddingModelInfo,
  mockGetFileMetadataByKeys,
  mockProcessDocument,
  mockTrigger,
} = vi.hoisted(() => ({
  mockCheckActorUsageLimits: vi.fn(),
  mockBatchTrigger: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetBoundWorkspaceFileSecretProvenanceByMetadata: vi.fn(),
  mockGetEmbeddingModelInfo: vi.fn(),
  mockGetFileMetadataByKeys: vi.fn(),
  mockProcessDocument: vi.fn(),
  mockTrigger: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  tasks: { batchTrigger: mockBatchTrigger, trigger: mockTrigger },
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: mockProcessDocument,
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  MAX_KB_EMBEDDING_DIMENSIONS: 3072,
  toKbEmbeddingDimensions: (value: number) => value,
  getEmbeddingModelInfo: mockGetEmbeddingModelInfo,
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

import { env } from '@/lib/core/config/env'
import {
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'
import {
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
} from '@/lib/embeddings'
import * as embeddingClient from '@/lib/embeddings/client'
import { EmbeddingAPIError, EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import {
  PermanentDocumentProcessingError,
  UsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import { processDocumentAsync, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { MAX_PROCESSING_ATTEMPTS } from '@/lib/knowledge/documents/types'

const mockEmbeddingCapacity = vi.fn<typeof embeddingClient.assertKnowledgeEmbeddingCapacity>()
beforeEach(() => {
  mockEmbeddingCapacity.mockReset().mockResolvedValue(undefined)
  vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockImplementation(
    mockEmbeddingCapacity
  )
})

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
  connectorId: null,
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
    mockGetEmbeddingModelInfo.mockReturnValue({
      tokenizerProvider: 'openai',
      maxInputTokens: 8191,
    })
  })

  it.each([
    { name: 'known quota exhaustion', failure: new EmbeddingQuotaExhaustedError('openai') },
    { name: 'quota storage failure', failure: new Error('Quota storage unavailable') },
    { name: 'cancellation', failure: new DOMException('Cancelled', 'AbortError') },
  ])('avoids source download and OCR on $name', async ({ failure }) => {
    mockEmbeddingCapacity.mockRejectedValueOnce(failure)
    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: PERSISTED_CONTEXT.filename,
        fileUrl: PERSISTED_CONTEXT.fileUrl,
        fileSize: PERSISTED_CONTEXT.fileSize,
        mimeType: PERSISTED_CONTEXT.mimeType,
      })
    ).rejects.toBe(failure)
    expect(mockEmbeddingCapacity).toHaveBeenCalledWith({
      model: PERSISTED_CONTEXT.embeddingModel,
      dimensions: PERSISTED_CONTEXT.embeddingDimension,
      workspaceId: PERSISTED_CONTEXT.workspaceId,
      signal: expect.any(AbortSignal),
    })
    expect(mockProcessDocument).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
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
      {
        userId: PERSISTED_CONTEXT.uploadedBy,
        knowledgeAccess: undefined,
        signal: expect.any(AbortSignal),
      },
      null,
      undefined,
      undefined
    )
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('reads a connector-owned source file as the system, not as the actor', async () => {
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ ...PERSISTED_CONTEXT, connectorId: 'connector-1' }])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])

    await processDocumentAsync('knowledge-base-1', 'document-1', {
      filename: PERSISTED_CONTEXT.filename,
      fileUrl: PERSISTED_CONTEXT.fileUrl,
      fileSize: PERSISTED_CONTEXT.fileSize,
      mimeType: PERSISTED_CONTEXT.mimeType,
    })

    expect(mockProcessDocument).toHaveBeenCalledWith(
      PERSISTED_CONTEXT.fileUrl,
      PERSISTED_CONTEXT.filename,
      PERSISTED_CONTEXT.mimeType,
      1024,
      200,
      100,
      {
        userId: PERSISTED_CONTEXT.uploadedBy,
        knowledgeAccess: SYSTEM_ACCESS_SCOPE,
        signal: expect.any(AbortSignal),
      },
      null,
      undefined,
      undefined
    )
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
      {
        userId: PERSISTED_CONTEXT.uploadedBy,
        knowledgeAccess: undefined,
        signal: expect.any(AbortSignal),
      },
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
    mockGetEmbeddingModelInfo.mockReturnValue({
      tokenizerProvider: 'openai',
      maxInputTokens: 8191,
    })
  })

  /** Asserts the write that set `status` exists, and returns its guard clause. */
  function guardForStatusWrite(status: string): unknown {
    const setIndex = dbChainMockFns.set.mock.calls.findIndex(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === status
    )
    expect(setIndex).toBeGreaterThanOrEqual(0)

    const setOrder = dbChainMockFns.set.mock.invocationCallOrder[setIndex]
    const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
      (whereOrder) => whereOrder > setOrder
    )
    expect(whereIndex).toBeGreaterThanOrEqual(0)
    return dbChainMockFns.where.mock.calls[whereIndex]?.[0]
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

  it('signals ownership before a claimed processing attempt can fail', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockRejectedValueOnce(new Error('processor failed after claim'))
    const onClaimed = vi.fn()

    await expect(
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'a.pdf',
          fileUrl: 'https://example.com/a.pdf',
          fileSize: 1,
          mimeType: 'text/plain',
        },
        {},
        undefined,
        'request-1',
        { chargedAtDispatch: true, onClaimed }
      )
    ).rejects.toThrow('processor failed after claim')

    expect(onClaimed).toHaveBeenCalledTimes(1)
    expect(guardForStatusWrite('processing')).toBeDefined()
    expect(guardForStatusWrite('failed')).toBeDefined()
  })

  it('accepts a legacy queuedAt-only payload only while the row has no token', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    const processingQueuedAt = new Date('2026-08-24T22:00:00.000Z')

    await processDocumentAsync(
      'knowledge-base-1',
      'document-1',
      {
        filename: 'a.pdf',
        fileUrl: 'https://example.com/a.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      },
      {},
      undefined,
      'request-1',
      { chargedAtDispatch: true, processingQueuedAt }
    )

    const claimGuard = guardForStatusWrite('processing')
    expect(
      hasMockCondition(
        claimGuard,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingQueuedAt &&
          node.right === processingQueuedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        claimGuard,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
      )
    ).toBe(true)
  })

  it('accepts a pre-rollout payload only while the row has no token', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )

    await processDocumentAsync(
      'knowledge-base-1',
      'document-1',
      {
        filename: 'a.pdf',
        fileUrl: 'https://example.com/a.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      },
      {},
      undefined,
      'request-1',
      { chargedAtDispatch: false }
    )

    const claimGuard = guardForStatusWrite('processing')
    expect(
      hasMockCondition(
        claimGuard,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.processingQueueToken
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        claimGuard,
        (node: MockCondition) =>
          node.type === 'eq' && node.left === schemaMock.document.processingQueuedAt
      )
    ).toBe(false)
  })

  it('uses the queue token as the authoritative claim and final-write generation', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )

    await processDocumentAsync(
      'knowledge-base-1',
      'document-1',
      {
        filename: 'a.pdf',
        fileUrl: 'https://example.com/a.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      },
      {},
      undefined,
      'request-1',
      {
        chargedAtDispatch: true,
        processingQueueToken: 'request-1',
        processingQueuedAt: new Date('2026-08-24T22:00:00.000Z'),
      }
    )

    for (const status of ['processing', 'completed']) {
      const guard = guardForStatusWrite(status)
      expect(
        hasMockCondition(
          guard,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.processingQueueToken &&
            node.right === 'request-1'
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          guard,
          (node: MockCondition) =>
            node.type === 'eq' &&
            node.left === schemaMock.document.userExcluded &&
            node.right === false
        )
      ).toBe(true)
    }

    const completion = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'completed'
    )
    expect(completion?.[0]).toMatchObject({
      processingQueueToken: null,
      processingQueuedAt: null,
    })
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

  it('records a mutable usage-limit failure and refunds a charged dispatch attempt', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([PERSISTED_CONTEXT])
    mockCheckActorUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded. Upgrade to continue.',
    })

    await expect(
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'a.pdf',
          fileUrl: 'https://example.com/a.pdf',
          fileSize: 1,
          mimeType: 'text/plain',
        },
        {},
        undefined,
        undefined,
        {
          chargedAtDispatch: true,
          processingQueuedAt: new Date('2026-08-24T22:00:00.000Z'),
        }
      )
    ).rejects.toBeInstanceOf(UsageLimitDocumentProcessingError)

    expect(mockProcessDocument).not.toHaveBeenCalled()
    const failure = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failure?.[0]).toMatchObject({
      processingError: 'Usage limit exceeded. Upgrade to continue.',
    })
    const attempts = (failure?.[0] as Record<string, unknown>).processingAttempts as {
      toSQL: () => { params: unknown[]; sql: string }
    }
    expect(attempts.toSQL().sql).toBe('GREATEST(? - 1, 0)')
    expect(attempts.toSQL().params).toEqual([schemaMock.document.processingAttempts])
  })

  it('fails before embedding when a stored chunk exceeds the model input ceiling', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockGetEmbeddingModelInfo.mockReturnValue({
      tokenizerProvider: 'openai',
      maxInputTokens: 1,
    })
    mockProcessDocument.mockResolvedValue({
      chunks: [
        {
          text: 'This chunk is too large for the selected embedding model.',
          metadata: { startIndex: 0, endIndex: 57 },
        },
      ],
      metadata: { chunkCount: 1, tokenCount: 12, characterCount: 57 },
    })

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'large.txt',
        fileUrl: 'https://example.com/large.txt',
        fileSize: 57,
        mimeType: 'text/plain',
      })
    ).rejects.toMatchObject({
      name: 'PermanentDocumentProcessingError',
      code: 'document_complexity_limit',
    })

    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  it('dead-letters deterministic input failures after recording an actionable reason', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockRejectedValue(
      new PermanentDocumentProcessingError(
        'encrypted_file',
        'This file is encrypted or password-protected. Remove the protection and retry.'
      )
    )

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'protected.xlsx',
        fileUrl: 'https://example.com/protected.xlsx',
        fileSize: 1,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    ).rejects.toMatchObject({
      code: 'encrypted_file',
    })

    const failure = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failure?.[0]).toMatchObject({
      processingError:
        'This file is encrypted or password-protected. Remove the protection and retry.',
      processingAttempts: 5,
    })
  })

  it('keeps infrastructure failures eligible for automatic recovery', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockRejectedValue(new Error('Storage request timed out'))

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'report.docx',
        fileUrl: 'https://example.com/report.docx',
        fileSize: 1,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).rejects.toThrow('Storage request timed out')

    const failure = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failure).toBeDefined()
    expect(failure![0]).not.toHaveProperty('processingAttempts')
  })

  it('dead-letters rejected customer-managed embedding credentials until the user retries', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockResolvedValue({
      chunks: [{ text: 'Index me', metadata: { startIndex: 0, endIndex: 8 } }],
      metadata: { chunkCount: 1, tokenCount: 2, characterCount: 8 },
    })
    mockGenerateEmbeddings.mockRejectedValue(
      new EmbeddingAPIError('Embedding API failed: 401', 401, true)
    )

    await expect(
      processDocumentAsync('knowledge-base-1', 'document-1', {
        filename: 'report.docx',
        fileUrl: 'https://example.com/report.docx',
        fileSize: 1,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).rejects.toMatchObject({ status: 401, isBYOK: true })

    const failure = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failure?.[0]).toMatchObject({
      processingError: BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
      processingAttempts: MAX_PROCESSING_ATTEMPTS,
    })
  })

  it.each([
    { chargedAtDispatch: true, refundsAttempt: true },
    { chargedAtDispatch: false, refundsAttempt: false },
  ])(
    'refunds only a charged document attempt when provider credit is exhausted',
    async ({ chargedAtDispatch, refundsAttempt }) => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([PERSISTED_CONTEXT])
        .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
        .mockResolvedValueOnce([{ id: 'document-1' }])
      mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
      mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
        new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
      )
      mockProcessDocument.mockResolvedValue({
        chunks: [{ text: 'Index me', metadata: { startIndex: 0, endIndex: 8 } }],
        metadata: { chunkCount: 1, tokenCount: 2, characterCount: 8 },
      })
      mockGenerateEmbeddings.mockRejectedValue(new EmbeddingQuotaExhaustedError('openai'))

      await expect(
        processDocumentAsync(
          'knowledge-base-1',
          'document-1',
          {
            filename: 'report.docx',
            fileUrl: 'https://example.com/report.docx',
            fileSize: 1,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          {},
          undefined,
          undefined,
          {
            chargedAtDispatch,
            processingQueuedAt: new Date('2026-08-24T22:00:00.000Z'),
          }
        )
      ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)

      const failure = dbChainMockFns.set.mock.calls.find(
        (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
      )
      expect(failure).toBeDefined()
      expect(failure?.[0]).toMatchObject({
        processingError: EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
      })
      const attempts = (failure![0] as Record<string, unknown>).processingAttempts as
        | { toSQL: () => { params: unknown[]; sql: string } }
        | undefined
      if (refundsAttempt) {
        expect(attempts?.toSQL().sql).toBe('GREATEST(? - 1, 0)')
        expect(attempts?.toSQL().params).toEqual([schemaMock.document.processingAttempts])
      } else {
        expect(failure![0]).not.toHaveProperty('processingAttempts')
      }
    }
  )
})

describe('in-process quota continuation dispatch', () => {
  const envSnapshot = { ...env }
  const queuedDocument = {
    documentId: 'document-1',
    filename: PERSISTED_CONTEXT.filename,
    fileUrl: PERSISTED_CONTEXT.fileUrl,
    fileSize: PERSISTED_CONTEXT.fileSize,
    mimeType: PERSISTED_CONTEXT.mimeType,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    resetInsideTriggerRunForTests()
    setEnvFlags({ isTriggerDevEnabled: false })
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: undefined })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: null }])
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
    mockProcessDocument.mockResolvedValue({
      chunks: [{ text: 'Index me', metadata: { startIndex: 0, endIndex: 8 } }],
      metadata: { chunkCount: 1, tokenCount: 2, characterCount: 8 },
    })
    mockGetEmbeddingModelInfo.mockReturnValue({
      tokenizerProvider: 'openai',
      maxInputTokens: 8191,
    })
    mockGenerateEmbeddings.mockRejectedValue(new EmbeddingQuotaExhaustedError('openai'))
    mockTrigger.mockResolvedValue({ id: 'quota-continuation-run' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetInsideTriggerRunForTests()
    resetEnvFlagsMock()
  })

  afterAll(() => {
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, envSnapshot)
  })

  it('durably defers quota exhaustion in direct mode before reporting acceptance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)

    await expect(
      processDocumentsWithQueue([queuedDocument], 'knowledge-base-1', {}, 'request-1', undefined)
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-process-document',
      expect.objectContaining({
        documentId: 'document-1',
        processingQueuedAt: expect.any(String),
        quotaRetryCount: 1,
      }),
      expect.objectContaining({
        idempotencyKey: 'knowledge-quota-document-1-request-1-1',
        delay: expect.any(Date),
      })
    )

    const deferredUntil = mockTrigger.mock.calls[0]?.[2]?.delay as Date
    expect(deferredUntil.getTime()).toBeGreaterThanOrEqual(1_000 + 5 * 60 * 1000 * 0.8)
    expect(deferredUntil.getTime()).toBeLessThanOrEqual(1_000 + 5 * 60 * 1000 * 1.2)

    const deferredWriteIndex = dbChainMockFns.set.mock.calls.findIndex(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingDeferredUntil instanceof Date
    )
    expect(deferredWriteIndex).toBeGreaterThanOrEqual(0)
    expect(dbChainMockFns.set.mock.calls[deferredWriteIndex]?.[0]).toMatchObject({
      processingStatus: 'pending',
      processingQueuedAt: deferredUntil,
      processingStartedAt: null,
      processingDeferredUntil: deferredUntil,
      processingCompletedAt: null,
      processingError: null,
    })
    expect(mockTrigger.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.set.mock.invocationCallOrder[deferredWriteIndex]
    )
  })

  it.each(['preflight', 'request'])(
    'preserves a tokenless queue stamp across an accepted %s quota continuation',
    async (stage) => {
      const originalQueuedAt = new Date('2026-08-24T22:00:00.000Z')
      const deferredUntil = new Date('2026-08-24T23:00:00.000Z')
      resetDbChainMock()
      dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
      dbChainMockFns.limit
        .mockResolvedValueOnce([PERSISTED_CONTEXT])
        .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
        .mockResolvedValueOnce([{ id: 'document-1' }])
      mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
      mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
        new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
      )
      mockProcessDocument.mockResolvedValue({
        chunks: [{ text: 'Index me', metadata: { startIndex: 0, endIndex: 8 } }],
        metadata: { chunkCount: 1, tokenCount: 2, characterCount: 8 },
      })
      if (stage === 'preflight')
        mockEmbeddingCapacity.mockRejectedValueOnce(new EmbeddingQuotaExhaustedError('openai'))
      mockGenerateEmbeddings.mockRejectedValue(new EmbeddingQuotaExhaustedError('openai'))

      await expect(
        processDocumentAsync(
          'knowledge-base-1',
          'document-1',
          {
            filename: 'report.docx',
            fileUrl: 'https://example.com/report.docx',
            fileSize: 1,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          {},
          undefined,
          'request-1',
          {
            chargedAtDispatch: false,
            processingQueuedAt: originalQueuedAt,
            scheduleQuotaContinuation: vi.fn().mockResolvedValue(deferredUntil),
          }
        )
      ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)

      expect(mockProcessDocument).toHaveBeenCalledTimes(stage === 'preflight' ? 0 : 1)
      const deferredWrite = dbChainMockFns.set.mock.calls.find(
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.processingDeferredUntil ===
          deferredUntil
      )
      expect(deferredWrite?.[0]).toMatchObject({
        processingStatus: 'pending',
        processingDeferredUntil: deferredUntil,
      })
      expect(deferredWrite?.[0]).not.toHaveProperty('processingQueuedAt')
      expect(
        dbChainMockFns.where.mock.calls.some((call) =>
          hasMockCondition(
            call[0],
            (node) =>
              node.type === 'eq' &&
              node.left === schemaMock.document.processingQueuedAt &&
              node.right === originalQueuedAt
          )
        )
      ).toBe(true)
    }
  )

  it('stops automatic retries after the bounded quota continuation chain is exhausted', async () => {
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])

    await expect(
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        queuedDocument,
        {},
        undefined,
        'request-1',
        {
          chargedAtDispatch: false,
          processingQueuedAt: new Date('2026-08-24T22:00:00.000Z'),
          quotaContinuationExhausted: true,
        }
      )
    ).rejects.toBeInstanceOf(EmbeddingQuotaExhaustedError)

    const failure = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failure?.[0]).toMatchObject({
      processingError: EMBEDDING_QUOTA_EXHAUSTED_MESSAGE,
      processingAttempts: MAX_PROCESSING_ATTEMPTS,
    })
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('durably defers quota exhaustion after a failed Trigger batch fallback', async () => {
    markInsideTriggerRun()
    mockBatchTrigger.mockRejectedValue(new Error('batch unavailable'))

    await expect(
      processDocumentsWithQueue([queuedDocument], 'knowledge-base-1', {}, 'request-1', undefined)
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(mockBatchTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledWith(
      'knowledge-process-document',
      expect.objectContaining({ documentId: 'document-1', quotaRetryCount: 1 }),
      expect.objectContaining({
        idempotencyKey: 'knowledge-quota-document-1-request-1-1',
      })
    )
  })

  it('keeps a claimed direct dispatch accepted when quota continuation handoff fails', async () => {
    mockTrigger.mockRejectedValue(new Error('continuation unavailable'))

    await expect(
      processDocumentsWithQueue([queuedDocument], 'knowledge-base-1', {}, 'request-1', undefined)
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    const failure = dbChainMockFns.set.mock.calls.find(
      (call) =>
        (call[0] as Record<string, unknown> | undefined)?.processingError ===
        'continuation unavailable'
    )
    expect(failure?.[0]).toMatchObject({
      processingStatus: 'failed',
      processingDeferredUntil: null,
    })
  })
})
