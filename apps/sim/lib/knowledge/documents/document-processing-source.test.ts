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
import {
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import { getAllMockLoggers, getMockLogger } from '@sim/testing/mocks/logger.mock'
import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { tasks } from '@trigger.dev/sdk'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAttributedUsageLimits,

  mockGetEmbeddingModelInfo,

  mockProcessDocument,
} = vi.hoisted(() => ({
  mockCheckAttributedUsageLimits: vi.fn(),
  mockGetEmbeddingModelInfo: vi.fn(),
  mockProcessDocument: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/document-processor', () => ({
  processDocument: mockProcessDocument,
}))

vi.mock('@/lib/knowledge/embedding-models', () => ({
  MAX_KB_EMBEDDING_DIMENSIONS: 3072,
  toKbEmbeddingDimensions: (value: number) => value,
  getEmbeddingModelInfo: mockGetEmbeddingModelInfo,
}))

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import * as billingAttribution from '@/lib/billing/core/billing-attribution'
import { resetUsageGateCache } from '@/lib/billing/core/usage-gate-cache'
import { env } from '@/lib/core/config/env'
import {
  markInsideTriggerRun,
  resetInsideTriggerRunForTests,
} from '@/lib/core/config/trigger-runtime'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EMBEDDING_QUOTA_EXHAUSTED_MESSAGE } from '@/lib/embeddings'
import * as embeddingClient from '@/lib/embeddings/client'
import { EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import {
  PermanentDocumentProcessingError,
  UsageLimitDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import { KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-continuation-dispatch'
import { KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT } from '@/lib/knowledge/documents/processing-outbox-event'
import { processDocumentAsync, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { MAX_PROCESSING_ATTEMPTS } from '@/lib/knowledge/documents/types'

const mockGenerateEmbeddings = knowledgeEmbeddingsMockFns.mockGenerateEmbeddings

const mockBatchTrigger = vi.mocked(tasks.batchTrigger)
const mockTrigger = vi.mocked(tasks.trigger)

const { error: mockLogError } = getMockLogger('DocumentService')

const mockGetFileMetadataByKeys = uploadsMetadataMockFns.mockGetFileMetadataByKeys
const mockGetBoundWorkspaceFileSecretProvenanceByMetadata =
  workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenanceByMetadata

const mockEmbeddingCapacity = vi.fn<typeof embeddingClient.assertKnowledgeEmbeddingCapacity>()
beforeEach(() => {
  resetUsageGateCache()
  vi.spyOn(billingAttribution, 'checkAttributedUsageLimits').mockImplementation(
    mockCheckAttributedUsageLimits
  )
  mockEmbeddingCapacity.mockReset().mockResolvedValue(undefined)
  vi.spyOn(embeddingClient, 'assertKnowledgeEmbeddingCapacity').mockImplementation(
    mockEmbeddingCapacity
  )
})

const PERSISTED_KEY = 'workspace/workspace-1/persisted.pdf'
const PERSISTED_URL = `/api/files/serve/${encodeURIComponent(PERSISTED_KEY)}?context=workspace`
const CONTENT_UPDATED_AT = new Date('2026-08-05T12:00:00.000Z')

const PERSISTED_CONTEXT = {
  workspaceId: 'workspace-1',
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

const BILLING_ATTRIBUTION: billingAttribution.BillingAttributionSnapshot = {
  actorUserId: 'uploader-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user', id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
    source: 'default',
  },
  payerSubscription: null,
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
    resetDbChainMock()
    // The processing claim is guarded and returns the row it claimed; without a
    // stub every worker would read as 'already completed' and return early.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
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
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: PERSISTED_CONTEXT.filename,
          fileUrl: PERSISTED_CONTEXT.fileUrl,
          fileSize: PERSISTED_CONTEXT.fileSize,
          mimeType: PERSISTED_CONTEXT.mimeType,
        },
        {},
        BILLING_ATTRIBUTION
      )
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
    await processDocumentAsync(
      'knowledge-base-1',
      'document-1',
      {
        filename: 'stale.pdf',
        fileUrl: 'https://example.com/stale.pdf',
        fileSize: 1,
        mimeType: 'text/plain',
      },
      {},
      BILLING_ATTRIBUTION
    )

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
        processingDeadlineAt: expect.any(Number),
      },
      PERSISTED_CONTEXT.workspaceId,
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
      .mockResolvedValueOnce([{ id: 'document-1' }])

    await processDocumentAsync(
      'knowledge-base-1',
      'document-1',
      {
        filename: PERSISTED_CONTEXT.filename,
        fileUrl: PERSISTED_CONTEXT.fileUrl,
        fileSize: PERSISTED_CONTEXT.fileSize,
        mimeType: PERSISTED_CONTEXT.mimeType,
      },
      {},
      BILLING_ATTRIBUTION
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
        knowledgeAccess: SYSTEM_ACCESS_SCOPE,
        signal: expect.any(AbortSignal),
        processingDeadlineAt: expect.any(Number),
      },
      PERSISTED_CONTEXT.workspaceId,
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
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'stale.pdf',
          fileUrl: 'https://example.com/stale.pdf',
          fileSize: 1,
          mimeType: 'text/plain',
        },
        {},
        BILLING_ATTRIBUTION
      )
    ).rejects.toThrow('Knowledge document secret provenance is unavailable')

    expect(mockProcessDocument).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
  })

  describe('execution source provenance', () => {
    const executionKey = 'execution/workspace-1/workflow-1/run-1/source.pdf'
    const executionUrl = `/api/files/serve/${encodeURIComponent(executionKey)}?context=workspace`
    const executionBinding = {
      ...SOURCE_BINDING,
      key: executionKey,
      context: 'execution',
      secretProvenanceVersion: 1,
    }

    beforeEach(() => {
      dbChainMockFns.limit
        .mockReset()
        .mockResolvedValueOnce([{ ...PERSISTED_CONTEXT, fileUrl: executionUrl }])
        .mockResolvedValueOnce([{ ...PERSISTED_PROVENANCE_ROW, fileUrl: executionUrl }])
        .mockResolvedValueOnce([{ id: 'document-1' }])
        .mockResolvedValueOnce([{ id: 'document-1' }])
      mockGetFileMetadataByKeys.mockImplementation(async (_keys: string[], context: string) =>
        context === 'execution' ? [executionBinding] : []
      )
    })

    function process() {
      return processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'untrusted-queued-name.txt',
          fileUrl: 'https://example.com/untrusted-queued-url.txt',
          fileSize: 1,
          mimeType: 'text/plain',
        },
        {},
        BILLING_ATTRIBUTION
      )
    }

    it.each(['unknown', 'missing'])(
      'refuses tracked execution sources with %s sidecars before parsing',
      async (kind) => {
        mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
          new Map(kind === 'unknown' ? [[executionBinding.id, { status: 'unknown' }]] : [])
        )

        await expect(process()).rejects.toThrow(
          'Knowledge document secret provenance is unavailable'
        )

        expect(mockProcessDocument).not.toHaveBeenCalled()
        expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
      }
    )

    it('refuses a source whose execution metadata belongs to another workspace', async () => {
      mockGetFileMetadataByKeys.mockResolvedValue([
        { ...executionBinding, workspaceId: 'other-workspace' },
      ])

      await expect(process()).rejects.toThrow('Document file is not owned by this knowledge base')

      expect(mockProcessDocument).not.toHaveBeenCalled()
      expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
    })
  })
})

describe('processDocumentAsync write guards', () => {
  function armProviderSource(): void {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockGetFileMetadataByKeys.mockResolvedValue([SOURCE_BINDING])
    mockGetBoundWorkspaceFileSecretProvenanceByMetadata.mockResolvedValue(
      new Map([[SOURCE_BINDING.id, { status: 'exact', entries: [] }]])
    )
  }
  beforeEach(() => {
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
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
      BILLING_ATTRIBUTION
    )

    /**
     * Unguarded, a late or duplicate dispatch flipped `completed` back to
     * `processing`, discarding a pass that had already indexed and billed.
     */
    expect(guardForStatusWrite('processing')).toBeDefined()
  })

  describe('a transient database failure', () => {
    const databaseError = () =>
      new DrizzleQueryError(
        'insert private SQL',
        ['private bound content'],
        Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        })
      )

    async function failWith(error: Error, scheduleDatabaseRetry: (error: unknown) => Date | null) {
      armProviderSource()
      mockProcessDocument.mockRejectedValueOnce(error)
      return processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        PERSISTED_CONTEXT,
        {},
        BILLING_ATTRIBUTION,
        'pass-1',
        {
          chargedAtDispatch: true,
          processingQueueToken: 'pass-1',
          processingQueuedAt: new Date(),
          scheduleDatabaseRetry,
        }
      ).catch((caught: unknown) => caught)
    }

    it('leaves the document pending until its scheduled retry instead of failed', async () => {
      const error = databaseError()
      const retryAt = new Date(Date.now() + 120_000)
      const schedule = vi.fn().mockReturnValue(retryAt)

      expect(await failWith(error, schedule)).toBe(error)

      expect(schedule).toHaveBeenCalledWith(error)
      const pending = dbChainMockFns.set.mock.calls.find(
        ([value]) => value.processingDeferredUntil === retryAt
      )?.[0]
      expect(pending).toMatchObject({
        processingStatus: 'pending',
        processingError: null,
        processingDeferredUntil: retryAt,
        processingStartedAt: null,
        processingCompletedAt: null,
      })
      /** The same run retries, so its queue token and retry budget stay as they are. */
      expect(pending).not.toHaveProperty('processingQueueToken')
      expect(pending).not.toHaveProperty('processingAttempts')
      /** Stamped only when unset, so a dispatch cannot claim it as never queued meanwhile. */
      expect(pending.processingQueuedAt.toSQL().sql).toMatch(/^COALESCE\(.+, \?\)$/)
      expect(
        dbChainMockFns.set.mock.calls.some(([value]) => value.processingStatus === 'failed')
      ).toBe(false)
      expect(guardForStatusWrite('pending')).toBeDefined()
    })

    /** The row the deferral write returns: the document as it now stands. */
    function deferredRow(connectorId: string | null, retryAt: Date, queuedAt: Date) {
      return {
        id: 'document-1',
        knowledgeBaseId: 'knowledge-base-1',
        connectorId,
        uploadedAt: new Date(0),
        processingStatus: 'pending',
        processingQueueToken: 'pass-1',
        processingQueuedAt: queuedAt,
        processingStartedAt: null,
        processingDeferredUntil: retryAt,
        processingCompletedAt: null,
        processingRecoveryAfter: null,
      }
    }

    function deferredRetryChecks() {
      return dbChainMockFns.values.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .filter((value) => value.eventType === KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT)
    }

    it('records the failure once no retry is scheduled', async () => {
      const error = databaseError()
      dbChainMockFns.returning.mockResolvedValue([deferredRow(null, new Date(), new Date())])
      expect(await failWith(error, () => null)).toBe(error)
      expect(deferredRetryChecks()).toHaveLength(0)

      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          processingStatus: 'failed',
          processingError: 'Database request failed (SQLSTATE 57014).',
          processingDeferredUntil: null,
        })
      )
    })
  })

  it('records the failed embedding batch without exposing SQL, content or vectors', async () => {
    armProviderSource()
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'document-1' }])
    mockProcessDocument.mockResolvedValueOnce({
      chunks: [{ text: 'private-content', metadata: { startIndex: 0, endIndex: 15 } }],
      metadata: { chunkCount: 1, tokenCount: 3, characterCount: 15 },
    })
    mockGenerateEmbeddings.mockResolvedValueOnce({
      embeddings: [[0.123456789]],
      billableTokens: 0,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    })
    const databaseError = new DrizzleQueryError(
      'insert private SQL',
      ['private-content', [0.123456789]],
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    )
    dbChainMockFns.values.mockRejectedValueOnce(databaseError)

    await expect(
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'a.txt',
          fileUrl: 'https://example.com/a.txt',
          fileSize: 15,
          mimeType: 'text/plain',
        },
        {},
        BILLING_ATTRIBUTION
      )
    ).rejects.toBe(databaseError)

    expect(mockLogError).toHaveBeenCalledWith('[document-1] Failed to insert embedding batch', {
      knowledgeBaseId: 'knowledge-base-1',
      operation: 'embedding.insert',
      batchNumber: 1,
      batchSize: 1,
      totalChunks: 1,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      elapsedMs: expect.any(Number),
      diagnostic: {
        category: 'database',
        code: '57014',
        databaseReason: 'statement_timeout',
        message: 'Database request failed (SQLSTATE 57014).',
      },
    })
    const logs = JSON.stringify(getAllMockLoggers().flatMap((logger) => logger.error.mock.calls))
    expect(logs).not.toContain('private')
    expect(logs).not.toContain('0.123456789')
    expect(guardForStatusWrite('failed')).toBeDefined()
    expect(
      dbChainMockFns.set.mock.calls.some(([value]) => value.processingStatus === 'completed')
    ).toBe(false)
  })

  it('accepts a legacy queuedAt-only payload only while the row has no token', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
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
      BILLING_ATTRIBUTION,
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

  it('uses the queue token as the authoritative claim and final-write generation', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
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
      BILLING_ATTRIBUTION,
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
      .mockResolvedValueOnce([{ id: 'document-1' }])
    // The guarded claim matched no rows: another pass owns this document.
    dbChainMockFns.returning.mockReset().mockResolvedValue([])

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
      BILLING_ATTRIBUTION
    )

    expect(mockProcessDocument).not.toHaveBeenCalled()
  })

  it('records a mutable usage-limit failure and refunds a charged dispatch attempt', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([PERSISTED_CONTEXT])
    mockCheckAttributedUsageLimits.mockResolvedValue({
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
        BILLING_ATTRIBUTION,
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
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'large.txt',
          fileUrl: 'https://example.com/large.txt',
          fileSize: 57,
          mimeType: 'text/plain',
        },
        {},
        BILLING_ATTRIBUTION
      )
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
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        {
          filename: 'protected.xlsx',
          fileUrl: 'https://example.com/protected.xlsx',
          fileSize: 1,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        {},
        BILLING_ATTRIBUTION
      )
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

  it.each([true, false])(
    'defers OCR capacity and refunds only the original admission (%s)',
    async (chargedAtDispatch) => {
      armProviderSource()
      const error = new ProviderCapacityDeferredError('rate_limit', { retryAfterMs: 600_000 })
      const deferredUntil = new Date(Date.now() + 600_000)
      const schedule = vi
        .fn()
        .mockResolvedValue({ deferredUntil, processingQueueToken: 'continuation-1' })
      mockProcessDocument.mockRejectedValue(error)
      await expect(
        processDocumentAsync(
          'knowledge-base-1',
          'document-1',
          PERSISTED_CONTEXT,
          {},
          BILLING_ATTRIBUTION,
          'pass-1',
          {
            chargedAtDispatch,
            processingQueueToken: 'pass-1',
            processingQueuedAt: new Date(),
            scheduleProviderContinuation: schedule,
          }
        )
      ).rejects.toBe(error)
      expect(schedule).toHaveBeenCalledWith(error)
      expect(mockGenerateEmbeddings).not.toHaveBeenCalled()
      const deferred = dbChainMockFns.set.mock.calls.find(
        ([value]) => value.processingDeferredUntil === deferredUntil
      )?.[0]
      expect(deferred).toMatchObject({
        processingStatus: 'pending',
        processingError: null,
        processingDeferredUntil: deferredUntil,
        processingQueuedAt: deferredUntil,
        processingStartedAt: null,
        processingCompletedAt: null,
      })
      if (chargedAtDispatch)
        expect(deferred.processingAttempts.toSQL().sql).toBe('GREATEST(? - 1, 0)')
      else expect(deferred).not.toHaveProperty('processingAttempts')
      expect(
        dbChainMockFns.set.mock.calls.some(([value]) => value.processingStatus === 'failed')
      ).toBe(false)
      expect(
        dbChainMockFns.where.mock.calls.some(([where]) =>
          hasMockCondition(
            where,
            (node) =>
              node.type === 'eq' &&
              node.left === schemaMock.document.processingQueueToken &&
              node.right === 'pass-1'
          )
        )
      ).toBe(true)
    }
  )

  it('reports discarded output when the generation changes before the index commit', async () => {
    armProviderSource()
    dbChainMockFns.limit.mockReset()
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([])
    expect(
      await processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        PERSISTED_CONTEXT,
        {},
        BILLING_ATTRIBUTION
      )
    ).toEqual({ outcome: 'skipped', reason: 'superseded' })
    expect(
      dbChainMockFns.set.mock.calls.some(([value]) => value.processingStatus === 'completed')
    ).toBe(false)
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
          BILLING_ATTRIBUTION,
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
    resetDbChainMock()
    resetInsideTriggerRunForTests()
    setEnvFlags({ isTriggerDevEnabled: false })
    for (const key of Object.keys(env)) delete (env as Record<string, unknown>)[key]
    Object.assign(env, { ...defaultMockEnv, TRIGGER_SECRET_KEY: undefined })
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ userId: 'knowledge-owner', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
      .mockResolvedValueOnce([{ id: 'document-1' }])
    mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
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
      processDocumentsWithQueue(
        [queuedDocument],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION,
        'interactive'
      )
    ).resolves.toEqual({ requested: 1, accepted: 1, failed: 0, failedDocumentIds: [] })

    expect(mockTrigger).not.toHaveBeenCalled()
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'knowledge-quota-document-1-request-1-1',
        eventType: KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
        payload: expect.objectContaining({
          documentId: 'document-1',
          processingQueuedAt: expect.any(String),
          quotaRetryCount: 1,
        }),
        availableAt: expect.any(Date),
      })
    )

    const deferredUntil = dbChainMockFns.values.mock.calls[0][0].availableAt as Date
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
    expect(dbChainMockFns.values.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.set.mock.invocationCallOrder[deferredWriteIndex]
    )
  })

  it('stops automatic retries after the bounded quota continuation chain is exhausted', async () => {
    resetDbChainMock()
    dbChainMockFns.returning.mockResolvedValue([{ id: 'document-1' }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([PERSISTED_CONTEXT])
      .mockResolvedValueOnce([PERSISTED_PROVENANCE_ROW])
      .mockResolvedValueOnce([{ id: 'document-1' }])
      .mockResolvedValueOnce([{ id: 'document-1' }])

    await expect(
      processDocumentAsync(
        'knowledge-base-1',
        'document-1',
        queuedDocument,
        {},
        BILLING_ATTRIBUTION,
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

  it('keeps a claimed direct dispatch accepted when quota continuation handoff fails', async () => {
    markInsideTriggerRun()
    mockBatchTrigger.mockRejectedValue(new Error('batch unavailable'))
    mockTrigger.mockRejectedValue(new Error('continuation unavailable'))

    await expect(
      processDocumentsWithQueue(
        [queuedDocument],
        'knowledge-base-1',
        {},
        'request-1',
        BILLING_ATTRIBUTION,
        'interactive'
      )
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
