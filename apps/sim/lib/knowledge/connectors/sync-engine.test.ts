import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  dbChainMockFns,
  flattenMockConditions,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock as resetDatabaseMock,
  resetEnvFlagsMock,
  schemaMock,
} from '@sim/testing'
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import {
  knowledgeDocumentsServiceMock,
  knowledgeDocumentsServiceMockFns,
} from '@sim/testing/mocks/knowledge-documents-service.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { triggerAvailabilityMock } from '@sim/testing/mocks/trigger-availability.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { generateShortId } from '@sim/utils/id'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import {
  buildSyncDatabaseRetryUpdate,
  buildSyncFailureUpdate,
  executeSync,
} from '@/lib/knowledge/connectors/sync-engine'
import {
  CREDENTIAL_REVOKED_SYNC_ERROR,
  MAX_CONSECUTIVE_FAILURES,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  classifySuspectListing,
  evaluateListingSafety,
  isStuckDocumentSweepEligible,
  mergeHydratedDocument,
  mergeHydratedSkippedDocument,
  type PreviousListingObservation,
  selectStuckDocumentSweepCandidates,
  stuckDocumentSweepAgeAnchor,
} from '@/lib/knowledge/connectors/sync-primitives'
import type { ExternalDocument } from '@/connectors/types'

const mockProcessDocumentsWithQueue = knowledgeDocumentsServiceMockFns.mockProcessDocumentsWithQueue

const mockUploadFile = storageServiceMockFns.mockUploadFile

const mockDeleteFile = storageServiceMockFns.mockDeleteFile
const mockDeleteFileMetadata = uploadsMetadataMockFns.mockDeleteFileMetadata
uploadsMetadataMockFns.mockGetFileMetadataByKeys.mockImplementation(async (keys: string[]) =>
  keys.flatMap((key) => bindings.get(key) ?? [])
)
uploadsMetadataMockFns.mockInsertImmutableFileMetadata.mockImplementation(
  async (options: { id: string; key: string }) => {
    const binding = { id: options.id, contentUpdatedAt: new Date(0) }
    bindings.set(options.key, binding)
    return binding
  }
)

beforeEach(resetEnvFlagsMock)

function resetDbChainMock() {
  resetDatabaseMock()
  dbChainMockFns.execute.mockImplementation(async () => [{ startedAt: new Date().toISOString() }])
}

vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)
vi.mock('@/lib/core/config/trigger-availability', () => triggerAvailabilityMock)
vi.mock('@/lib/uploads', () => uploadsMock)
const { mockEnqueueStorageCleanup } = vi.hoisted(() => ({
  mockEnqueueStorageCleanup: vi.fn(async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'cleanup-guard' }])
    return ['cleanup-guard']
  }),
}))
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
const bindings = vi.hoisted(() => new Map<string, { id: string; contentUpdatedAt: Date }>())
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  KNOWLEDGE_STORAGE_CLEANUP_EVENT: 'knowledge.document.storage.cleanup',
  enqueueKnowledgeStorageCleanup: mockEnqueueStorageCleanup,
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
}))
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/background/knowledge-connector-sync', () => ({
  knowledgeConnectorSync: { trigger: vi.fn() },
}))

const { mockGetDocument, mockMapTags, mockListDocuments } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockMapTags: vi.fn(),
  mockListDocuments: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    jira: {
      mapTags: mockMapTags,
    },
    'no-tags': {
      name: 'No Tags',
    },
    paged: {
      name: 'Paged',
      auth: { mode: 'apiKey', optional: true },
      getDocument: mockGetDocument,
      listDocuments: mockListDocuments,
    },
    keyed: {
      name: 'Keyed',
      auth: { mode: 'apiKey' },
      getDocument: mockGetDocument,
      listDocuments: mockListDocuments,
    },
    oauth: {
      name: 'OAuth',
      auth: { mode: 'oauth', provider: 'example' },
      getDocument: mockGetDocument,
      listDocuments: mockListDocuments,
    },
  },
}))

describe('shouldRunIncrementalSync', () => {
  const lastSyncAt = '2026-07-01T00:00:00.000Z'

  it('runs incrementally when everything is eligible', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      shouldRunIncrementalSync(true, 'incremental', undefined, undefined, false, lastSyncAt)
    ).toBe(true)
  })

  it('never runs incrementally on a forced fullSync or rehydrate', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(shouldRunIncrementalSync(true, 'incremental', true, undefined, false, lastSyncAt)).toBe(
      false
    )
    expect(shouldRunIncrementalSync(true, 'incremental', undefined, true, false, lastSyncAt)).toBe(
      false
    )
  })

  it('forces a full listing whenever pending-removal documents exist, so they get a resurrect-or-confirm decision', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      shouldRunIncrementalSync(true, 'incremental', undefined, undefined, true, lastSyncAt)
    ).toBe(false)
  })
})

describe('classifyExternalDoc', () => {
  const base = { content: 'hello', contentDeferred: false, contentHash: 'h1' }

  it('keeps an already-indexed file as-is when it becomes skipped (last-known-good)', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    expect(
      classifyExternalDoc(
        { ...base, content: '', skippedReason: 'too big' },
        {
          id: 'doc-1',
          contentHash: 'old',
          storageKey: 'kb/indexed-file.txt',
        }
      )
    ).toEqual({ type: 'unchanged' })
  })

  it('rehydrates a content-less placeholder even when its listing hash is unchanged', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      classifyExternalDoc(
        { ...base, content: '', contentDeferred: true },
        { id: 'doc-1', contentHash: 'h1', storageKey: null }
      )
    ).toEqual({ type: 'update', existingId: 'doc-1' })
  })

  it('replaces stale indexed content for an authoritative skip', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      classifyExternalDoc(
        {
          ...base,
          content: '',
          skippedReason: 'no extractable text',
          skippedExistingDisposition: 'replace',
        },
        { id: 'doc-1', contentHash: 'old' }
      )
    ).toEqual({ type: 'skip', existingId: 'doc-1' })
  })

  it('forces re-hydration of an unchanged deferred doc when forceRehydrate is set', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    const deferred = { ...base, content: '', contentDeferred: true }
    // Same hash → normally unchanged, but forceRehydrate promotes it to update.
    expect(classifyExternalDoc(deferred, { id: 'doc-1', contentHash: 'h1' }, true)).toEqual({
      type: 'update',
      existingId: 'doc-1',
    })
  })
})

describe('connector content replacement processing state', () => {
  const CONNECTOR = {
    id: 'connector-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'paged',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    accessMode: 'workspace',
    status: 'active',
    lastSyncAt: null,
    lastSyncDocCount: 1,
    consecutiveFailures: 0,
    syncLockToken: null,
  }

  beforeEach(() => {
    resetDbChainMock()
    mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
      key: customKey,
      path: `/api/files/serve/${encodeURIComponent(customKey)}`,
    }))
    mockProcessDocumentsWithQueue.mockResolvedValue({ requested: 1, accepted: 1, failed: 0 })
  })

  it('refuses a queued live Search source before locking or indexing content', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(schemaMock.knowledgeBase, [{ isSearchIndex: true }])
    const result = await executeSync('connector-1', {
      dispatchToken: 'queued-before-switch',
      billingAttribution: {
        actorUserId: 'user',
        workspaceId: 'ws-1',
        organizationId: null,
        billedAccountUserId: 'user',
        billingEntity: { type: 'user', id: 'user' },
        billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
        payerSubscription: null,
      },
    })
    expect(result.skipReason).toBe('connector_not_syncable')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
  })

  it('resets a near-dead-letter prior version when authoritative content changes', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { MAX_PROCESSING_ATTEMPTS } = await import('@/lib/knowledge/documents/types')

    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    for (let i = 0; i < 20; i++) {
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          connectorArchivedAt: null,
          connectorDeletedAt: null,
          kbDeletedAt: null,
        },
      ])
    }
    for (let i = 0; i < 10; i++) {
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1', userId: 'u-1', workspaceId: 'ws-1' }])
    }
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [
      {
        id: 'doc-1',
        externalId: 'external-1',
        contentHash: 'old-hash',
        deletedAt: null,
        userExcluded: false,
        processingAttempts: MAX_PROCESSING_ATTEMPTS - 1,
      },
    ])
    for (let i = 0; i < 2; i++) {
      queueTableRows(schemaMock.document, [
        { fileUrl: '/api/files/serve/kb/old-document.txt?context=knowledge-base' },
      ])
    }
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [{ count: 1 }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([CONNECTOR])
      .mockResolvedValueOnce([{ id: 'doc-1' }])

    mockListDocuments.mockResolvedValue({
      documents: [
        {
          externalId: 'external-1',
          title: 'Updated document',
          content: 'authoritative new content',
          contentHash: 'new-hash',
          mimeType: 'text/plain',
          metadata: {},
        },
      ],
      hasMore: false,
    })

    await executeSync('connector-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
      fullSync: true,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStatus: 'pending',
        processingQueuedAt: null,
        processingQueueToken: null,
        processingDeferredUntil: null,
        processingAttempts: 0,
      })
    )
  })
})

/** The run's lease as the persistence writes see it; the condition itself is opaque to the chain mock. */
const lease = { stillHeld: () => ({ type: 'lease' }) as never }

describe('persistSkippedDocuments', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('does not delete old storage when the authoritative replacement fails', async () => {
    const { persistSkippedDocuments } = await import('@/lib/knowledge/connectors/sync-persistence')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    queueTableRows(schemaMock.document, [])

    await expect(
      persistSkippedDocuments(
        'kb-1',
        'connector-1',
        'no-tags',
        [
          {
            type: 'skip',
            existingId: 'missing-doc',
            extDoc: {
              externalId: 'external-1',
              title: 'Empty document',
              content: '',
              mimeType: 'text/plain',
              contentHash: 'new-empty-hash',
              skippedReason: 'Document contains no extractable text',
              skippedExistingDisposition: 'replace',
            },
          },
        ],
        undefined,
        'workspace',
        lease
      )
    ).rejects.toThrow('Document missing-doc is no longer active')

    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteFileMetadata).not.toHaveBeenCalled()
  })
})

describe('persistHashOnlyUpdates', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('updates only the retry hash for a last-known-good connector document', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    const { persistHashOnlyUpdates } = await import('@/lib/knowledge/connectors/sync-persistence')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

    await expect(
      persistHashOnlyUpdates(
        'kb-1',
        'connector-1',
        [
          {
            existingId: 'doc-1',
            externalId: 'page-1',
            contentHash: 'notion:retry:v1:page-1',
          },
        ],
        lease
      )
    ).resolves.toEqual([])

    expect(dbChainMockFns.set).toHaveBeenCalledOnce()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      contentHash: 'notion:retry:v1:page-1',
    })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(
      classifyExternalDoc(
        {
          content: '',
          contentDeferred: true,
          contentHash: 'notion:v3:page-1:unchanged',
        },
        { id: 'doc-1', contentHash: 'notion:retry:v1:page-1' }
      )
    ).toEqual({ type: 'update', existingId: 'doc-1' })
  })
})

describe('chunkOpsByByteBudget', () => {
  const MB = 1024 * 1024
  const addOp = (sizeBytes?: number) => ({
    type: 'add' as const,
    extDoc: {
      externalId: `e-${generateShortId()}`,
      title: 'f',
      content: sizeBytes == null ? 'x' : '',
      contentDeferred: sizeBytes != null,
      contentHash: 'h',
      mimeType: 'text/plain',
      ...(sizeBytes != null ? { metadata: { fileSize: sizeBytes } } : {}),
    },
  })
  const skipOp = (sizeBytes: number) => ({
    type: 'skip' as const,
    extDoc: {
      externalId: `s-${generateShortId()}`,
      title: 'f',
      content: '',
      contentHash: 'h',
      mimeType: 'text/plain',
      skippedReason: 'too big',
      metadata: { fileSize: sizeBytes },
    },
  })

  it('isolates a file larger than the budget into its own chunk', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-primitives')
    const chunks = chunkOpsByByteBudget([addOp(100 * MB), addOp(1024)], 64 * MB, 5)
    expect(chunks.map((c) => c.length)).toEqual([1, 1])
  })

  it('caps summed bytes per chunk for medium files', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-primitives')
    // 40 + 40 = 80 MB exceeds the 64 MB budget, so they split.
    const chunks = chunkOpsByByteBudget([addOp(40 * MB), addOp(40 * MB)], 64 * MB, 5)
    expect(chunks.map((c) => c.length)).toEqual([1, 1])
  })

  it('hydrates deferred documents together when the listing estimates their size', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-primitives')
    const deferred = (estimatedBytes?: number) => ({
      type: 'add' as const,
      extDoc: {
        externalId: `d-${generateShortId()}`,
        title: 'f',
        content: '',
        contentDeferred: true,
        contentHash: 'h',
        mimeType: 'text/plain',
        ...(estimatedBytes != null ? { estimatedBytes } : {}),
      },
    })
    // Without an estimate each unknown download is assumed to fill the budget and runs alone.
    expect(chunkOpsByByteBudget([deferred(), deferred(), deferred()], 64 * MB, 5)).toHaveLength(3)
    // A mail thread that says it is small shares a batch with its neighbours.
    expect(
      chunkOpsByByteBudget(
        [deferred(256 * 1024), deferred(256 * 1024), deferred(256 * 1024)],
        64 * MB,
        5
      )
    ).toHaveLength(1)
  })

  it('treats skip ops as zero bytes so they do not consume the budget', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-primitives')
    const chunks = chunkOpsByByteBudget(
      [skipOp(100 * MB), skipOp(100 * MB), addOp(1024)],
      64 * MB,
      5
    )
    expect(chunks).toHaveLength(1)
  })
})

describe('connector sync working-set bounds', () => {
  it('reserves one sentinel row beyond the remaining corpus budget', async () => {
    const { CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS, sourcePageFitsSyncWorkingSet } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(sourcePageFitsSyncWorkingSet(CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS - 1, 1)).toBe(true)
    expect(sourcePageFitsSyncWorkingSet(CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS, 1)).toBe(false)
  })

  it('counts retained source payload in UTF-8 bytes', async () => {
    const { addSourcePagePayloadBytes, CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const document = {
      externalId: '',
      title: '',
      content: 'é',
      mimeType: 'text/plain',
      metadata: {},
    }

    expect(addSourcePagePayloadBytes(CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES - 4, [document])).toBe(
      CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES
    )
    expect(() =>
      addSourcePagePayloadBytes(CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES - 3, [document])
    ).toThrow('retained-payload limit')
  })
})

describe('executeSync page admission', () => {
  beforeEach(() => {
    resetDbChainMock()
  })
  it('rejects an oversized page before document work while retaining the checkpoint', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const connector = {
      id: 'c-1',
      knowledgeBaseId: 'kb-1',
      connectorType: 'paged',
      sourceConfig: {},
      syncMode: 'full',
      syncIntervalMinutes: 60,
      accessMode: 'workspace',
      status: 'active',
      lastSyncAt: null,
      consecutiveFailures: 0,
    }
    queueTableRows(schemaMock.knowledgeConnector, [connector])
    for (let i = 0; i < 10; i++) queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([connector])
    const item = {
      externalId: 'x',
      title: 'X',
      content: 'body',
      mimeType: 'text/plain',
      metadata: {},
    }
    mockListDocuments.mockResolvedValue({ documents: Array(50_001).fill(item), hasMore: false })
    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })
    expect(result.error).toContain('oversized document page')
    expect(mockListDocuments).toHaveBeenCalledTimes(1)
    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalledWith(schemaMock.document)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        listingCheckpoint: expect.objectContaining({ cursor: null, complete: false }),
      })
    )
  })
})

describe('executeSync deferred hydration rate limits', () => {
  const NOW = new Date('2026-08-29T03:00:00.000Z')
  const CONNECTOR = {
    id: 'c-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'paged',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    accessMode: 'workspace',
    status: 'active',
    lastSyncAt: null,
    lastSyncDocCount: null,
    consecutiveFailures: 0,
    syncLockToken: null,
  }

  const deferredDocument = (index: number): ExternalDocument => ({
    externalId: `external-${index}`,
    title: `Document ${index}`,
    content: '',
    contentDeferred: true,
    contentHash: `hash-${index}`,
    mimeType: 'text/plain',
    metadata: { size: 1024 },
  })

  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        { id: 'c-1', connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    for (let i = 0; i < 5; i++) queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.knowledgeConnector, [
      { connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
    ])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'c-1' }]).mockResolvedValueOnce([CONNECTOR])
    mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
      key: customKey,
      path: `/api/files/serve/${encodeURIComponent(customKey)}`,
    }))
    mockProcessDocumentsWithQueue.mockImplementation(async (documents: unknown[]) => ({
      accepted: documents.length,
      failed: 0,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a provider cooldown longer than the normal scheduler backoff cap', async () => {
    const retryAfterMs = 48 * 60 * 60 * 1000
    mockListDocuments.mockRejectedValueOnce(
      Object.assign(new Error('Provider cooldown'), { status: 429, retryAfterMs })
    )
    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })
    expect(result.error).toBeUndefined()
    expect(result.deferred?.reason).toBe('rate_limit')
    expect(new Date(result.deferred!.nextSyncAt).getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + retryAfterMs
    )
    const update = dbChainMockFns.set.mock.calls.find(([value]) => value.status === 'active')?.[0]
    expect(update.nextSyncAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + retryAfterMs)
  })

  it('stops after the active batch and preserves the provider retry delay', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const documents = Array.from({ length: 6 }, (_, index) => deferredDocument(index))
    const rateLimitError = Object.assign(new Error('HTTP 403 - upstream rate limit exceeded'), {
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      retryAfterMs: 45 * 60 * 1000,
    })

    mockListDocuments.mockResolvedValue({ documents, hasMore: false })
    mockGetDocument.mockImplementation(async (_token, _config, externalId: string) => {
      if (externalId === 'external-2') throw rateLimitError
      return {
        ...documents[Number(externalId.slice('external-'.length))],
        content: 'hydrated',
        contentDeferred: false,
      }
    })

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })

    expect(mockGetDocument).toHaveBeenCalledTimes(5)
    expect(mockGetDocument).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'external-5',
      expect.anything()
    )
    expect(result).toMatchObject({
      docsAdded: 4,
      docsFailed: 0,
      deferred: { reason: 'rate_limit', nextSyncAt: expect.any(String) },
    })
    expect(mockUploadFile).toHaveBeenCalledTimes(4)
    expect(mockProcessDocumentsWithQueue).toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
      })
    )
    const failureUpdate = dbChainMockFns.set.mock.calls.find(
      ([update]) => update.status === 'active'
    )?.[0]
    expect(failureUpdate?.nextSyncAt.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + 45 * 60 * 1000
    )
    expect(failureUpdate?.nextSyncAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 46 * 60 * 1000)
  })
})

describe('executeSync database failures', () => {
  const NOW = new Date('2026-08-29T03:00:00.000Z')

  async function failSyncWith(
    error: Error,
    consecutiveFailures?: number,
    firstPage?: { documents: ExternalDocument[] }
  ) {
    const connector = {
      id: 'c-1',
      knowledgeBaseId: 'kb-1',
      connectorType: 'paged',
      credentialId: null,
      encryptedApiKey: null,
      sourceConfig: {},
      syncMode: 'full',
      syncIntervalMinutes: 1440,
      accessMode: 'workspace',
      status: 'active',
      lastSyncAt: null,
      lastSyncDocCount: null,
      consecutiveFailures: consecutiveFailures ?? MAX_CONSECUTIVE_FAILURES - 1,
      syncLockToken: null,
    }
    queueTableRows(schemaMock.knowledgeConnector, [connector])
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        { id: 'c-1', connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    for (let i = 0; i < 5; i++) queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    for (let i = 0; i < 4; i++) queueTableRows(schemaMock.document, [])
    dbChainMockFns.returning.mockResolvedValue([{ id: 'c-1' }]).mockResolvedValueOnce([connector])
    if (firstPage) {
      mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
        key: customKey,
        path: `/api/files/serve/${encodeURIComponent(customKey)}`,
      }))
      mockProcessDocumentsWithQueue.mockImplementation(async (documents: unknown[]) => ({
        accepted: documents.length,
        failed: 0,
      }))
      mockListDocuments.mockResolvedValueOnce({
        documents: firstPage.documents,
        hasMore: true,
        nextCursor: 'page-2',
      })
    }
    mockListDocuments.mockRejectedValueOnce(error)

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })
    const terminal = dbChainMockFns.set.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .find((value) => 'consecutiveFailures' in value)
    return { result, terminal, MAX_CONSECUTIVE_FAILURES }
  }

  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not disable a connector one failure from the breaker over a database timeout', async () => {
    const timeout = new DrizzleQueryError(
      'select private SQL',
      ['private'],
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    )
    const { result, terminal, MAX_CONSECUTIVE_FAILURES } = await failSyncWith(timeout)

    expect(result.error).toBe('Database request failed (SQLSTATE 57014).')
    expect(terminal).toMatchObject({
      status: 'error',
      lastSyncError: 'Database request failed (SQLSTATE 57014).',
      consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
    })
    expect((terminal?.nextSyncAt as Date).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('backs a repeated database failure off by the streak in the run log', async () => {
    queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
      { status: 'failed', databaseFailureClass: 'capacity' },
      { status: 'failed', databaseFailureClass: 'capacity' },
      { status: 'completed', databaseFailureClass: null },
    ])
    const timeout = new DrizzleQueryError(
      'select private SQL',
      ['private'],
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    const { terminal } = await failSyncWith(timeout, 0)

    /** Two failed runs before this one: the third rung, with the breaker still at zero. */
    const delay = (terminal?.nextSyncAt as Date).getTime() - NOW.getTime()
    expect(delay).toBeGreaterThanOrEqual(90 * 60 * 1000)
    expect(delay).toBeLessThanOrEqual(91 * 60 * 1000)
    expect(terminal).toMatchObject({ status: 'error', consecutiveFailures: 0 })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', databaseFailureClass: 'capacity' })
    )
  })
})

describe('previous complete listing evidence', () => {
  beforeEach(() => {
    resetDbChainMock()
  })
  it.each([
    [55_000, 55_000],
    [0, 0],
    [null, 2],
  ])(
    'uses complete-cycle count %s without confusing an empty final worker for an empty source',
    async (listedCount, expected) => {
      const { loadPreviousListingObservation } = await import(
        '@/lib/knowledge/connectors/sync-primitives'
      )
      queueTableRows(schemaMock.knowledgeConnectorSyncLog, [
        {
          listedCount,
          docsAdded: 1,
          docsUpdated: 0,
          docsUnchanged: 1,
          docsSkipped: 0,
          docsFailed: 0,
        },
      ])
      await expect(
        loadPreviousListingObservation('connector', 'run', 55_000)
      ).resolves.toMatchObject({ listedCount: expected })
    }
  )
})

describe('classifySuspectListing', () => {
  it('flags an empty listing against a real corpus', () => {
    expect(classifySuspectListing(0, 3)).toBe('empty')
    expect(classifySuspectListing(0, 10_000)).toBe('empty')
  })

  it('ignores an empty listing on a trivially small corpus', () => {
    expect(classifySuspectListing(0, 0)).toBeNull()
    expect(classifySuspectListing(0, 2)).toBeNull()
  })

  it('flags a near-total collapse on a large corpus', () => {
    expect(classifySuspectListing(3, 10_000)).toBe('collapsed')
    expect(classifySuspectListing(49, 500)).toBe('collapsed')
  })

  it('allows an ordinary bulk deletion through', () => {
    expect(classifySuspectListing(1000, 10_000)).toBeNull()
    expect(classifySuspectListing(1, 8)).toBeNull()
    expect(classifySuspectListing(4, 49)).toBeNull()
  })
})

describe('evaluateListingSafety', () => {
  const previous = (
    listedCount: number,
    ownedCount: number,
    trustworthy = true
  ): PreviousListingObservation => ({ listedCount, ownedCount, trustworthy })

  it('blocks the first suspect empty listing', () => {
    expect(evaluateListingSafety(0, 500, previous(500, 500), undefined)).toEqual({
      reason: 'empty',
      blocked: true,
      corroborated: false,
    })
  })

  it('blocks when there is no previous completed sync to corroborate', () => {
    expect(evaluateListingSafety(0, 500, null, undefined).blocked).toBe(true)
  })

  it('reconciles once a consecutive sync sees the same empty listing', () => {
    expect(evaluateListingSafety(0, 500, previous(0, 500), undefined)).toEqual({
      reason: 'empty',
      blocked: false,
      corroborated: true,
    })
  })

  it('refuses to be corroborated by a possibly-incremental previous run', () => {
    expect(evaluateListingSafety(0, 500, previous(0, 500, false), undefined).blocked).toBe(true)
  })

  it('lets an explicit fullSync override the guard', () => {
    expect(evaluateListingSafety(0, 500, null, true)).toEqual({
      reason: 'empty',
      blocked: false,
      corroborated: false,
    })
  })
})

describe('mergeHydratedDocument', () => {
  const stub = (): ExternalDocument => ({
    externalId: 'file-1',
    title: 'Report.pdf',
    content: '',
    mimeType: 'text/plain',
    contentHash: 'sharepoint:file-1:v1',
    contentDeferred: true,
    metadata: { fileSize: 2_400_000 },
  })

  /**
   * A stub is built during listing, before the file is fetched, so it declares
   * `text/plain` for everything. Leaving that behind makes a hydrated PDF keep
   * claiming plain text — invisible while storage reads `sourceFile.mimeType`,
   * and a trap for anything that reaches for the obvious field instead.
   */
  it('carries the hydrated MIME type over the stub placeholder', () => {
    const merged = mergeHydratedDocument(
      stub(),
      {
        ...stub(),
        content: '',
        mimeType: 'application/pdf',
        sourceFile: {
          bytes: Buffer.from('%PDF'),
          fileName: 'Report.pdf',
          mimeType: 'application/pdf',
        },
      },
      'sharepoint:file-1:v2'
    )

    expect(merged.mimeType).toBe('application/pdf')
    expect(merged.sourceFile?.mimeType).toBe('application/pdf')
  })
})

describe('mergeHydratedSkippedDocument', () => {
  it('keeps the listing hash when hydration reports a synthetic skip hash', () => {
    const listed: ExternalDocument = {
      externalId: 'transcript-1',
      title: 'Weekly sync',
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain',
      contentHash: 'fireflies:v2:transcript-1:lifecycle-hash',
      metadata: { meetingDate: '2026-08-24T00:00:00.000Z' },
    }
    const skipped: ExternalDocument = {
      ...listed,
      contentDeferred: false,
      contentHash: 'fireflies:oversized-response:transcript-1',
      skippedReason: 'Transcript response exceeds the safe hydration limit',
      metadata: { duration: 45 },
    }

    expect(mergeHydratedSkippedDocument(listed, skipped)).toMatchObject({
      content: '',
      contentDeferred: false,
      contentHash: listed.contentHash,
      skippedReason: skipped.skippedReason,
      metadata: {
        meetingDate: '2026-08-24T00:00:00.000Z',
        duration: 45,
      },
    })
  })
})

describe('requireHydratedListedDocument', () => {
  it('turns ambiguous null hydration into a sync failure instead of a silent drop', async () => {
    const { requireHydratedListedDocument } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(() => requireHydratedListedDocument(null, 'listed-1')).toThrow(
      'Connector returned no content for listed document listed-1'
    )
  })
})

describe('recordUnverifiedExistingRefresh', () => {
  it('keeps last-known-good content while holding the incremental watermark', async () => {
    const { recordUnverifiedExistingRefresh } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const result = { docsFailed: 0 }
    const failedExternalIds = new Set<string>()

    recordUnverifiedExistingRefresh(result, failedExternalIds, 'existing-1')

    expect(result).toEqual({ docsFailed: 1 })
    expect(failedExternalIds).toEqual(new Set(['existing-1']))
  })
})

describe('isStuckDocumentSweepEligible', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')
  const minutesBefore = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000)

  const candidate = (
    processingStatus: string,
    overrides: {
      processingQueuedAt?: Date | null
      processingStartedAt?: Date | null
      processingDeferredUntil?: Date | null
      processingCompletedAt?: Date | null
      uploadedAt?: Date
    } = {}
  ) => ({
    processingStatus,
    processingQueuedAt: overrides.processingQueuedAt ?? null,
    processingStartedAt: overrides.processingStartedAt ?? null,
    processingDeferredUntil: overrides.processingDeferredUntil ?? null,
    processingCompletedAt: overrides.processingCompletedAt ?? null,
    uploadedAt: overrides.uploadedAt ?? minutesBefore(5),
  })

  /**
   * Pinned to `QUEUED_DISPATCH_GRACE_MS` in documents/types. A change to it
   * should fail here so it is re-checked deliberately rather than absorbed
   * silently.
   */
  const GRACE_MINUTES = 240

  it('reclaims a queued document once the grace period has passed', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES + 1),
          uploadedAt: minutesBefore(60 * 48),
        }),
        now
      )
    ).toBe(true)
  })

  it('reclaims a quota-deferred document only after its due time is stale', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { processingDeferredUntil: minutesBefore(239) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { processingDeferredUntil: minutesBefore(240) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { processingDeferredUntil: minutesBefore(241) }),
        now
      )
    ).toBe(true)
  })

  it('leaves a failed document alone while its Trigger retries may still run', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(1) }),
        now
      )
    ).toBe(false)
  })

  it('ages a failed document from its last attempt, not from its dispatch', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', {
          processingQueuedAt: minutesBefore(60 * 48),
          processingCompletedAt: minutesBefore(1),
          uploadedAt: minutesBefore(60 * 72),
        }),
        now
      )
    ).toBe(false)
  })

  it('reclaims a processing document only once its run is stale', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('processing', { processingStartedAt: minutesBefore(44) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('processing', { processingStartedAt: minutesBefore(46) }),
        now
      )
    ).toBe(true)
  })

  it('ignores a start time a worker left on a document that was requeued', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES - 1),
          processingStartedAt: minutesBefore(60 * 48),
          uploadedAt: minutesBefore(60 * 72),
        }),
        now
      )
    ).toBe(false)
  })

  it('never reclaims a completed document', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('completed', { uploadedAt: minutesBefore(60 * 48) }),
        now
      )
    ).toBe(false)
  })
})

describe('selectStuckDocumentSweepCandidates', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')
  const minutesBefore = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000)
  const oldCandidate = {
    processingQueuedAt: minutesBefore(300),
    processingStartedAt: null,
    processingDeferredUntil: null,
    processingCompletedAt: null,
    uploadedAt: minutesBefore(600),
  }

  it('filters before limiting so old uploads with fresh attempts cannot starve overdue work', () => {
    const recentlyRetried = Array.from({ length: 250 }, (_, index) => ({
      id: `recent-${index.toString().padStart(3, '0')}`,
      processingStatus: 'pending',
      ...oldCandidate,
      processingQueuedAt: minutesBefore(1),
    }))
    const overdue = {
      id: 'overdue',
      processingStatus: 'pending',
      ...oldCandidate,
      uploadedAt: minutesBefore(10),
    }

    expect(selectStuckDocumentSweepCandidates([...recentlyRetried, overdue], now)).toEqual([
      overdue,
    ])
  })

  it('orders by the status-specific age anchor and uses id as a stable tie-breaker', () => {
    const candidates = [
      {
        id: 'pending-newer',
        processingStatus: 'pending',
        ...oldCandidate,
        processingQueuedAt: minutesBefore(260),
      },
      {
        id: 'failed-b',
        processingStatus: 'failed',
        ...oldCandidate,
        processingCompletedAt: minutesBefore(400),
      },
      {
        id: 'failed-a',
        processingStatus: 'failed',
        ...oldCandidate,
        processingCompletedAt: minutesBefore(400),
      },
    ]

    expect(
      selectStuckDocumentSweepCandidates(candidates, now).map((candidate) => candidate.id)
    ).toEqual(['failed-a', 'failed-b', 'pending-newer'])
    expect(stuckDocumentSweepAgeAnchor(candidates[0])).toEqual(minutesBefore(260))
  })
})

describe('resolveReconciliationDeleteCap', () => {
  it('scales with the owned corpus above the absolute floor', async () => {
    const { resolveReconciliationDeleteCap } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(resolveReconciliationDeleteCap(1000)).toBe(250)
    expect(resolveReconciliationDeleteCap(400)).toBe(100)
    expect(resolveReconciliationDeleteCap(401)).toBe(100)
  })

  it('never drops below the absolute floor on a small corpus', async () => {
    const { resolveReconciliationDeleteCap } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(resolveReconciliationDeleteCap(0)).toBe(25)
    expect(resolveReconciliationDeleteCap(4)).toBe(25)
    expect(resolveReconciliationDeleteCap(40)).toBe(25)
    expect(resolveReconciliationDeleteCap(100)).toBe(25)
  })
})

describe('resolvePreviousOwnedCount', () => {
  it('falls back to the current owned count when the recorded count collapsed', async () => {
    const { resolvePreviousOwnedCount } = await import('@/lib/knowledge/connectors/sync-primitives')

    // lastSyncDocCount excludes tombstones, so a soft-delete pass drives it to 0.
    expect(resolvePreviousOwnedCount(0, 500)).toBe(500)
    expect(resolvePreviousOwnedCount(null, 500)).toBe(500)
    expect(resolvePreviousOwnedCount(undefined, 500)).toBe(500)
  })
})

describe('connectorDocumentSyncTarget', () => {
  it('cannot refresh a detached, moved, excluded, or archived document', async () => {
    const { connectorDocumentSyncTarget } = await import(
      '@/lib/knowledge/connectors/sync-persistence'
    )

    const condition = connectorDocumentSyncTarget('doc-1', 'kb-1', 'connector-1')
    for (const [column, value] of [
      [schemaMock.document.id, 'doc-1'],
      [schemaMock.document.knowledgeBaseId, 'kb-1'],
      [schemaMock.document.connectorId, 'connector-1'],
      [schemaMock.document.userExcluded, false],
    ] as const) {
      expect(
        hasMockCondition(
          condition,
          (node: MockCondition) =>
            node.type === 'eq' && node.left === column && node.right === value
        )
      ).toBe(true)
    }
    expect(
      hasMockCondition(
        condition,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.document.archivedAt
      )
    ).toBe(true)
  })
})

describe('buildSyncFailureUpdate', () => {
  const now = new Date('2026-08-20T00:00:00.000Z')
  const minutesAfter = (mins: number) => new Date(now.getTime() + mins * 60 * 1000)

  it('backs off on the shared ladder below the threshold', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    const first = buildSyncFailureUpdate(now, 0, 'boom')
    expect(first.status).toBe('error')
    expect(first.consecutiveFailures).toBe(1)
    expect(first.lastSyncError).toBe('boom')
    expect(first.nextSyncAt).toEqual(minutesAfter(30))

    const third = buildSyncFailureUpdate(now, 2, 'boom')
    expect(third.consecutiveFailures).toBe(3)
    expect(third.nextSyncAt).toEqual(minutesAfter(90))
  })

  it('does not schedule before a longer provider retry deadline', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(buildSyncFailureUpdate(now, 0, 'rate limited', 45 * 60 * 1000).nextSyncAt).toEqual(
      minutesAfter(45)
    )
  })

  it('does not let a shorter provider delay weaken the failure backoff', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(buildSyncFailureUpdate(now, 0, 'rate limited', 5 * 60 * 1000).nextSyncAt).toEqual(
      minutesAfter(30)
    )
  })

  it('caps an unreasonable provider delay at the existing one-day retry ceiling', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(
      buildSyncFailureUpdate(now, 0, 'rate limited', 30 * 24 * 60 * 60 * 1000).nextSyncAt
    ).toEqual(minutesAfter(24 * 60))
  })

  it('disables exactly at the threshold, not before it', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const { MAX_CONSECUTIVE_FAILURES } = await import('@/lib/knowledge/connectors/sync-limits')

    /**
     * The path the auto-disable breaker actually runs through in-process. Only
     * the reaper's SQL equivalent was covered before, so an off-by-one here —
     * disabling a connector one failure early — was invisible.
     */
    const below = buildSyncFailureUpdate(now, MAX_CONSECUTIVE_FAILURES - 2, 'boom')
    expect(below.status).toBe('error')
    expect(below.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES - 1)
    expect(below.nextSyncAt).not.toBeNull()

    const at = buildSyncFailureUpdate(now, MAX_CONSECUTIVE_FAILURES - 1, 'boom')
    expect(at.status).toBe('disabled')
    expect(at.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES)
    expect(at.nextSyncAt).toBeNull()
    expect(at.lastSyncError).toContain('reconnect')
  })
})

describe('buildSyncRateLimitUpdate', () => {
  const now = new Date('2026-08-20T00:00:00.000Z')

  it('preserves the failure counter and schedules after the provider deadline', async () => {
    const { buildSyncRateLimitUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const providerDelayMs = 45 * 60 * 1000
    const update = buildSyncRateLimitUpdate(now, 9, 'rate limited', providerDelayMs)

    expect(update.status).toBe('error')
    expect(update.lastSyncError).toBe('rate limited')
    expect(update.consecutiveFailures).toBe(9)
    expect(update.nextSyncAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + providerDelayMs)
    expect(update.nextSyncAt.getTime()).toBeLessThanOrEqual(
      now.getTime() + providerDelayMs + 60_000
    )
  })

  it('uses a conservative fallback without consuming the breaker', async () => {
    const { buildSyncRateLimitUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const update = buildSyncRateLimitUpdate(now, null, 'rate limited')
    const fallbackMs = 30 * 60 * 1000

    expect(update.consecutiveFailures).toBe(0)
    expect(update.nextSyncAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + fallbackMs)
    expect(update.nextSyncAt.getTime()).toBeLessThanOrEqual(now.getTime() + fallbackMs + 60_000)
  })
})

describe('buildSyncCapacityUpdate', () => {
  it('requires operator action without consuming the transient-failure breaker', async () => {
    const { buildSyncCapacityUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const now = new Date('2026-08-20T00:00:00.000Z')

    expect(buildSyncCapacityUpdate(now, 2, 'source is too large')).toEqual({
      status: 'error',
      lastSyncError: 'source is too large',
      nextSyncAt: null,
      consecutiveFailures: 2,
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: now,
    })
  })
})

describe('buildSyncDatabaseRetryUpdate', () => {
  const now = new Date('2026-08-20T00:00:00.000Z')
  const _minutesAfter = (mins: number) => now.getTime() + mins * 60 * 1000

  it('keeps the error visible without advancing the auto-disable counter', async () => {
    const update = buildSyncDatabaseRetryUpdate(now, MAX_CONSECUTIVE_FAILURES - 1, 'db timeout', 40)
    expect(update).toMatchObject({
      status: 'error',
      lastSyncError: 'db timeout',
      consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1,
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: now,
    })
  })

  it('leaves a later source failure to be judged on source failures alone', async () => {
    let failures = 1
    for (let run = 0; run < 30; run++) {
      failures = buildSyncDatabaseRetryUpdate(
        now,
        failures,
        'db timeout',
        30 * 60 * 1000
      ).consecutiveFailures
    }
    const sourceFailure = buildSyncFailureUpdate(now, failures, 'source broke')
    expect(sourceFailure.status).toBe('error')
    expect(sourceFailure.consecutiveFailures).toBe(2)
  })
})

describe('buildSyncSuccessUpdate', () => {
  const now = new Date('2026-08-20T00:00:00.000Z')

  it('carries a hold notice into lastSyncError instead of clearing it', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    /**
     * The sequencing assertion. This update runs at the end of the sync, long
     * after the hold is detected, so writing the notice at the hold site would
     * be clobbered here.
     */
    const update = buildSyncSuccessUpdate(now, 42, null, 'held: 500 removals withheld')

    expect(update.lastSyncError).toBe('held: 500 removals withheld')
  })

  it('preserves the incremental watermark when source work failed', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    const update = buildSyncSuccessUpdate(now, 42, null, null, false)

    expect(update).not.toHaveProperty('lastSyncAt')
    expect(update.status).toBe('active')
    expect(update.nextSyncAt).toBeNull()
  })
})

describe('isContentPassIncomplete', () => {
  it('is true only when the listing has not finished or a source read failed', async () => {
    const { isContentPassIncomplete } = await import('@/lib/knowledge/connectors/sync-engine')
    const checkpoint = { startedAt: '2026-09-04T00:00:00Z', listedCount: 4 }
    for (const complete of [true, false]) {
      for (const unsafe of [true, false]) {
        for (const contentFailures of [true, false, undefined]) {
          expect(
            isContentPassIncomplete({
              complete,
              checkpoint: { ...checkpoint, unsafe, contentFailures },
            })
          ).toBe(!complete || contentFailures === true)
        }
      }
    }
  })
})

describe('completeSuccessfulSync', () => {
  const RESULT = {
    docsAdded: 1,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 1,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }

  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([false, true])(
    'preserves directory and listing notices without blocking healthy content watermarks: listing failure %s',
    async (hasListingFailure) => {
      const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')
      queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
      queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
      queueTableRows(schemaMock.document, [{ count: 4 }])
      dbChainMockFns.returning
        .mockResolvedValueOnce([{ id: 'log-1' }])
        .mockResolvedValueOnce([{ id: 'c-1' }])
      const directoryNotice =
        'Directory refresh incomplete: 1 group membership could not be verified.'
      const contentNotice = 'Unlisted documents were kept.'

      await expect(
        completeSuccessfulSync(
          'c-1',
          'kb-1',
          'log-1',
          60,
          { ...RESULT, docsFailed: 0 },
          contentNotice,
          {
            complete: true,
            checkpoint: {
              unsafe: hasListingFailure,
              startedAt: '2026-09-04T00:00:00Z',
              listedCount: 4,
              listingFailures: hasListingFailure
                ? {
                    count: 1,
                    samples: [
                      {
                        scope: 'unavailable@example.com',
                        operation: 'gmail.threads.list',
                        status: 400,
                        reasons: ['failedPrecondition'],
                      },
                    ],
                  }
                : null,
            },
          },
          directoryNotice
        )
      ).resolves.toBe(true)

      const logUpdate = dbChainMockFns.set.mock.calls.find(
        ([value]) => value.status === 'partial'
      )?.[0]
      const connectorUpdate = dbChainMockFns.set.mock.calls.find(
        ([value]) => value.status === 'active'
      )?.[0]
      expect(logUpdate.errorMessage).toContain(directoryNotice)
      expect(logUpdate.errorMessage).toContain(contentNotice)
      expect(connectorUpdate.lastSyncError).toBe(logUpdate.errorMessage)
      expect(connectorUpdate.listingCheckpoint).toBeNull()
      expect(connectorUpdate.consecutiveFailures).toBe(0)
      expect(connectorUpdate.nextSyncAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
      if (hasListingFailure) {
        expect(connectorUpdate).not.toHaveProperty('lastSyncAt')
        expect(logUpdate.errorMessage).toContain(
          'unavailable@example.com (gmail.threads.list, HTTP 400, failedPrecondition)'
        )
        expect(logUpdate.errorMessage).toContain('next scheduled sync')
      } else {
        expect(connectorUpdate.lastSyncAt).toEqual(new Date('2026-09-04T00:00:00Z'))
      }
    }
  )

  it('counts the documents before taking the completion locks', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.document, [{ count: 4 }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])

    await expect(completeSuccessfulSync('c-1', 'kb-1', 'log-1', 60, RESULT, null)).resolves.toBe(
      true
    )

    const countOrder = dbChainMockFns.from.mock.invocationCallOrder[0]
    const transactionOrder = dbChainMockFns.transaction.mock.invocationCallOrder[0]
    expect(dbChainMockFns.from.mock.calls[0][0]).toBe(schemaMock.document)
    expect(countOrder).toBeLessThan(transactionOrder)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', lastSyncDocCount: 4 })
    )
  })

  it('keeps the previous document count when the count cannot be read', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    dbChainMockFns.where.mockImplementationOnce(() =>
      Promise.reject(
        new DrizzleQueryError(
          'select private SQL',
          [],
          Object.assign(new Error('canceling statement due to statement timeout'), {
            code: '57014',
          })
        )
      )
    )
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])

    await expect(completeSuccessfulSync('c-1', 'kb-1', 'log-1', 60, RESULT, null)).resolves.toBe(
      true
    )

    const successWrite = dbChainMockFns.set.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .find((value) => value.status === 'active')
    expect(successWrite).toBeDefined()
    expect(successWrite).not.toHaveProperty('lastSyncDocCount')
    expect(successWrite).toMatchObject({ consecutiveFailures: 0 })
  })

  it('publishes neither terminal state when lock ownership is gone', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')

    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(completeSuccessfulSync('c-1', 'kb-1', 'log-1', 60, RESULT, null)).resolves.toBe(
      false
    )

    expect(dbChainMockFns.set).not.toHaveBeenCalled()
  })

  it('records a held listing as a completed sync whose watermark advances', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.document, [{ count: 4 }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])
    const holdNotice = 'Source listing is incomplete; unlisted documents were kept.'

    expect(
      await completeSuccessfulSync(
        'c-1',
        'kb-1',
        'log-1',
        60,
        { ...RESULT, docsFailed: 0 },
        holdNotice,
        {
          complete: true,
          checkpoint: {
            unsafe: true,
            contentFailures: false,
            startedAt: '2026-09-04T00:00:00Z',
            listedCount: 4,
          },
        }
      )
    ).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', docsFailed: 0, listedCount: 4 })
    )
    const connectorUpdate = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.status === 'active'
    )?.[0] as Record<string, unknown>
    expect(connectorUpdate.lastSyncAt).toEqual(new Date('2026-09-04T00:00:00Z'))
    expect(connectorUpdate.lastSyncError).toBe(holdNotice)
    expect(connectorUpdate.listingCheckpoint).toBeNull()
    expect((connectorUpdate.nextSyncAt as Date).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
  })

  it('does not publish connector state when the guarded log close is refused', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')

    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.document, [{ count: 4 }])
    dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await expect(completeSuccessfulSync('c-1', 'kb-1', 'log-1', 60, RESULT, null)).resolves.toBe(
      false
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    )
  })
})

describe('stillHoldsSyncLock', () => {
  it('requires the connector to still be syncing', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    /**
     * Without this a run reclaimed by the stale sweep still writes its terminal
     * result: clearing the backoff, un-disabling the connector, and resetting a
     * failure counter the sweep just advanced.
     */
    expect(
      hasMockCondition(
        stillHoldsSyncLock('c-1', 'run-a'),
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'syncing'
      )
    ).toBe(true)
  })
})

describe('writeTerminalConnectorState', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('applies the sync-lock guard itself so no caller can omit it', async () => {
    const { writeTerminalConnectorState } = await import('@/lib/knowledge/connectors/sync-engine')

    /**
     * The property that closes the gap a shared-helper-by-convention left open:
     * both terminal paths route through here and neither builds a WHERE clause,
     * so removing the guard is a single-site edit that this assertion catches.
     */
    await writeTerminalConnectorState('c-1', 'run-a', { status: 'active' })

    const where = dbChainMockFns.where.mock.calls[0][0]
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'syncing'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.id &&
          node.right === 'c-1'
      )
    ).toBe(true)
    // The token must be the run's own, not some other value that merely fills the slot.
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.syncLockToken &&
          node.right === 'run-a'
      )
    ).toBe(true)
  })
})

describe('markSyncSuperseded', () => {
  const result = {
    docsAdded: 3,
    docsUpdated: 1,
    docsDeleted: 0,
    docsUnchanged: 2,
    docsFailed: 0,
  }

  it('flags a discarded run so the task wrapper does not report it as clean', async () => {
    const { markSyncSuperseded, SUPERSEDED_SYNC_ERROR } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    expect(markSyncSuperseded(result).skipReason).toBe(SUPERSEDED_SYNC_ERROR)
  })
})

/**
 * Evaluates a mocked drizzle condition tree against a plain row.
 *
 * The row-queue mocks return whatever was queued regardless of the predicate, so
 * "this WHERE admits run B and rejects run A" is only observable by interpreting
 * the condition tree the guard emits.
 */
function conditionMatchesRow(condition: unknown, row: Record<string, unknown>): boolean {
  return flattenMockConditions(condition).every((node) => {
    if (node.type === 'eq') return row[node.left as string] === node.right
    if (node.type === 'isNull') return row[node.column as string] == null
    throw new Error(`unhandled condition node: ${String(node.type)}`)
  })
}

describe('sync lock ownership across a reclaim and reacquire', () => {
  const RUN_A = 'run-a'
  const RUN_B = 'run-b'

  /** The connector row once run B has taken the lock that run A used to hold. */
  const rowHeldByB = {
    [schemaMock.knowledgeConnector.id]: 'c-1',
    [schemaMock.knowledgeConnector.status]: 'syncing',
    [schemaMock.knowledgeConnector.syncLockToken]: RUN_B,
    [schemaMock.knowledgeConnector.archivedAt]: null,
    [schemaMock.knowledgeConnector.deletedAt]: null,
  }

  it('rejects the reclaimed run A and admits the live run B', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    /**
     * A outlived the TTL, the reaper reclaimed its lock, and replacement B took
     * it — so the row reads `syncing` again. Guarding on status alone matched A
     * here and let the dead run clobber the live one, then rejected B's own
     * write as superseded. Exactly inverted.
     */
    expect(conditionMatchesRow(stillHoldsSyncLock('c-1', RUN_A), rowHeldByB)).toBe(false)
    expect(conditionMatchesRow(stillHoldsSyncLock('c-1', RUN_B), rowHeldByB)).toBe(true)
  })

  it('rejects a run whose connector was paused mid-sync', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    const paused = {
      ...rowHeldByB,
      [schemaMock.knowledgeConnector.status]: 'paused',
      [schemaMock.knowledgeConnector.syncLockToken]: RUN_A,
    }

    expect(conditionMatchesRow(stillHoldsSyncLock('c-1', RUN_A), paused)).toBe(false)
  })
})

describe('shouldHeartbeatSyncLock', () => {
  it('beats once the interval has elapsed', async () => {
    const { shouldHeartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    expect(shouldHeartbeatSyncLock(1_000, 0, 1_000)).toBe(true)
    expect(shouldHeartbeatSyncLock(1_001, 0, 1_000)).toBe(true)
  })
})

describe('heartbeatSyncLock', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('reports a lost lock so the run can stop instead of racing its replacement', async () => {
    const { heartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    dbChainMockFns.returning.mockResolvedValueOnce([])
    expect(await heartbeatSyncLock('c-1', 'run-a')).toBe(false)

    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
    expect(await heartbeatSyncLock('c-1', 'run-a')).toBe(true)
  })

  it('can require the connector to remain live before destructive follow-up work', async () => {
    const { heartbeatLiveSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
    expect(await heartbeatLiveSyncLock('c-1', 'run-a')).toBe(true)

    const where = dbChainMockFns.where.mock.calls[0][0]
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.deletedAt
      )
    ).toBe(true)
  })
})

describe('executeSync heartbeats during the listing phase', () => {
  const CONNECTOR = {
    id: 'c-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'paged',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    accessMode: 'workspace',
    status: 'active',
    lastSyncAt: null,
    lastSyncDocCount: null,
    consecutiveFailures: 0,
    syncLockToken: null,
  }

  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Drives executeSync as far as the pagination loop. */
  function primeSyncUpToListing() {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        { id: 'c-1', connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    // The lock CAS; every later `.returning()` falls through to the empty default,
    // which is what makes the heartbeat below report a lost lock.
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1', accessMode: 'workspace' }])
  }

  /** A revoked grant recorded against the credential's account. */
  const INVALID_GRANT = { errorCode: 'invalid_grant', providerId: 'google-drive' } as const

  /** A locked OAuth connector whose token resolution the test controls. */
  function primeOAuthRunUpToToken() {
    const oauthConnector = {
      ...CONNECTOR,
      connectorType: 'oauth',
      credentialId: 'cred-1',
      accessMode: 'workspace',
    }
    queueTableRows(schemaMock.knowledgeConnector, [oauthConnector])
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        { id: 'c-1', connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    dbChainMockFns.returning.mockReset()
    dbChainMockFns.returning.mockResolvedValueOnce([oauthConnector])
    /** The terminal write lands on the row this run still holds. */
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
    const tokenUser = vi
      .spyOn(connectorTokens, 'resolveConnectorTokenUserId')
      .mockResolvedValueOnce('u-1')
    const resolveToken = vi
      .spyOn(connectorTokens, 'resolveConnectorAccessToken')
      .mockResolvedValueOnce(null)
    return () => {
      tokenUser.mockRestore()
      resolveToken.mockRestore()
    }
  }

  it('unschedules a connector whose credential the source rejected instead of retrying it', async () => {
    const restore = primeOAuthRunUpToToken()
    /** Rejected at token resolution and still rejected when the run records its outcome. */
    authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError
      .mockResolvedValueOnce(INVALID_GRANT)
      .mockResolvedValueOnce(INVALID_GRANT)
    try {
      const result = await executeSync('c-1', {
        billingAttribution: { workspaceId: 'ws-1' } as never,
      })
      expect(result.skipReason).toBe('credential_revoked')
      expect(result.error).toBeUndefined()
      expect(authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError).toHaveBeenCalledWith(
        'cred-1'
      )
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          nextSyncAt: null,
          lastSyncError: CREDENTIAL_REVOKED_SYNC_ERROR,
          syncLockToken: null,
          syncLockLeaseAt: null,
        })
      )
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailures: expect.any(Number) })
      )
    } finally {
      restore()
    }
  })

  it('takes the failure ladder when the credential was reauthorized while the run was failing', async () => {
    const restore = primeOAuthRunUpToToken()
    /** Rejected at token resolution, repaired by the time the run records its outcome. */
    authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError
      .mockResolvedValueOnce(INVALID_GRANT)
      .mockResolvedValueOnce(null)
    try {
      const result = await executeSync('c-1', {
        billingAttribution: { workspaceId: 'ws-1' } as never,
      })
      expect(result.skipReason).toBeUndefined()
      expect(result.error).toContain('rejected by the source')
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', consecutiveFailures: 1 })
      )
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ lastSyncError: CREDENTIAL_REVOKED_SYNC_ERROR })
      )
    } finally {
      restore()
    }
  })

  it('reports a run that could not record the unschedule as failed, not skipped', async () => {
    const restore = primeOAuthRunUpToToken()
    /** Rejected at token resolution and still rejected when the run records its outcome. */
    authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError
      .mockResolvedValueOnce(INVALID_GRANT)
      .mockResolvedValueOnce(INVALID_GRANT)
    /** The terminal write fails after the lock CAS consumed the first result. */
    dbChainMockFns.returning.mockReset()
    dbChainMockFns.returning.mockResolvedValueOnce([
      { ...CONNECTOR, connectorType: 'oauth', credentialId: 'cred-1', accessMode: 'workspace' },
    ])
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('connection reset'))
    try {
      const result = await executeSync('c-1', {
        billingAttribution: { workspaceId: 'ws-1' } as never,
      })
      expect(result.skipReason).toBeUndefined()
      expect(result.error).toContain('connection reset')
    } finally {
      restore()
    }
  })

  it.each([
    { errorCode: 'invalid_client', providerId: 'google-drive' },
    { errorCode: 'bad_client_secret', providerId: 'slack' },
    { errorCode: 'invalid_client', providerId: 'confluence' },
    { errorCode: 'unauthorized_client', providerId: 'microsoft' },
  ])(
    'keeps the failure ladder when the refresh failed on an app-registration fault: %j',
    async (rejection) => {
      const restore = primeOAuthRunUpToToken()
      authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError.mockResolvedValue(rejection)
      try {
        const result = await executeSync('c-1', {
          billingAttribution: { workspaceId: 'ws-1' } as never,
        })
        expect(result.skipReason).toBeUndefined()
        expect(result.error).toContain('Failed to obtain access token')
        expect(dbChainMockFns.set).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'error', consecutiveFailures: 1 })
        )
        expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
          expect.objectContaining({ lastSyncError: CREDENTIAL_REVOKED_SYNC_ERROR })
        )
      } finally {
        authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError.mockResolvedValue(null)
        restore()
      }
    }
  )

  it('keeps the failure ladder for a credential that resolved no token without a terminal error', async () => {
    const restore = primeOAuthRunUpToToken()
    authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError.mockResolvedValueOnce(null)
    try {
      const result = await executeSync('c-1', {
        billingAttribution: { workspaceId: 'ws-1' } as never,
      })
      expect(result.skipReason).toBeUndefined()
      expect(result.error).toContain('Failed to obtain access token')
      expect(dbChainMockFns.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', consecutiveFailures: 1 })
      )
    } finally {
      restore()
    }
  })

  it.each([
    { acl: undefined, incomplete: true },
    { acl: ['invalid-token'], incomplete: true },
    { acl: [], incomplete: false },
    { acl: ['u:reader@example.com'], incomplete: false },
  ])(
    'reports rejected mirrored permissions without rejecting valid grants: %j',
    async ({ acl, incomplete }) => {
      const contentPass = await import('@/lib/knowledge/connectors/sync-content-pass')
      primeSyncUpToListing()
      dbChainMockFns.returning.mockReset()
      dbChainMockFns.returning.mockResolvedValueOnce([{ ...CONNECTOR, accessMode: 'admin' }])
      /** No tombstone, then the stored document whose ACL the mirrored write changes. */
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.document, [{ id: 'doc-1', chunkCount: 1 }])
      let permissionResult: { permissionsIncomplete: boolean } | undefined
      const pass = vi
        .spyOn(contentPass, 'runConnectorContentPass')
        .mockImplementation(async (input) => {
          permissionResult = await input.onPage?.(
            [{ externalId: 'page-1', title: 'Page', content: 'Body', mimeType: 'text/plain', acl }],
            new Date()
          )
          throw new Error('Stopped after permission persistence')
        })
      try {
        const result = await executeSync('c-1', {
          billingAttribution: { workspaceId: 'ws-1' } as never,
        })
        expect(result.error).toBe('Stopped after permission persistence')
        expect(permissionResult).toEqual({ permissionsIncomplete: incomplete })
        expect(dbChainMockFns.set).toHaveBeenCalledWith(
          expect.objectContaining({
            acl: incomplete ? [] : acl,
          })
        )
      } finally {
        pass.mockRestore()
      }
    }
  )
})

describe('resolveStaleProcessingMinutes', () => {
  it('always exceeds the longest a legitimate run can take', async () => {
    const { resolveStaleProcessingMinutes, worstCaseProcessingMinutes } = await import(
      '@/lib/knowledge/connectors/sync-engine'
    )

    /**
     * The sweep reclaims by deleting embeddings and re-dispatching, so a value
     * at or below the worst-case run makes it delete live work. At the previous
     * fixed 45, raising KB_CONFIG_MAX_DURATION past 900s did exactly that.
     */
    for (const [maxDuration, maxAttempts] of [
      [600, 3],
      [900, 3],
      [3600, 3],
      [600, 10],
      [7200, 5],
    ]) {
      expect(resolveStaleProcessingMinutes(maxDuration, maxAttempts)).toBeGreaterThan(
        worstCaseProcessingMinutes(maxDuration, maxAttempts)
      )
    }
  })
})

describe('SWEEPABLE_PROCESSING_STATUSES', () => {
  it('covers every non-terminal state so nothing is stranded', async () => {
    const { SWEEPABLE_PROCESSING_STATUSES } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const { DOCUMENT_PROCESSING_STATUSES } = await import('@/lib/knowledge/documents/types')

    const unreclaimable = DOCUMENT_PROCESSING_STATUSES.filter(
      (status) => !SWEEPABLE_PROCESSING_STATUSES.includes(status as never)
    )
    expect(unreclaimable).toEqual(['completed'])
  })
})

describe('executeSync hard-delete reconciliation', () => {
  const OWNED_DOC_COUNT = 100
  const LISTED_DOC_COUNT = 60

  const CONNECTOR = {
    id: 'c-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'paged',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    accessMode: 'workspace',
    status: 'active',
    lastSyncAt: null,
    lastSyncDocCount: OWNED_DOC_COUNT,
    consecutiveFailures: 0,
    syncLockToken: null,
  }

  /** Owned documents, all with the same hash so the listing reads as unchanged. */
  const ownedDocs = Array.from({ length: OWNED_DOC_COUNT }, (_, i) => ({
    id: `doc-${i}`,
    externalId: `ext-${i}`,
    contentHash: 'h',
    deletedAt: null,
    userExcluded: false,
  }))
  const missingIds = ownedDocs.slice(LISTED_DOC_COUNT).map((d) => d.id)

  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(() => {
    resetDbChainMock()
    vi.useRealTimers()
  })

  /**
   * Primes every reconciliation read in order, including the unconditional
   * ownership check inside the destructive transaction.
   */
  function primeReconciliation() {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    for (let i = 0; i < 40; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          id: 'c-1',
          connectorArchivedAt: null,
          connectorDeletedAt: null,
          kbDeletedAt: null,
        },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, ownedDocs.slice(0, LISTED_DOC_COUNT))
    queueTableRows(schemaMock.document, [
      { ownedCount: OWNED_DOC_COUNT, listedCount: LISTED_DOC_COUNT, softCount: 40, hardCount: 40 },
    ])
    queueTableRows(
      schemaMock.document,
      missingIds.slice(0, 25).map((id) => ({ id }))
    )
    queueTableRows(
      schemaMock.document,
      missingIds.slice(25).map((id) => ({ id }))
    )
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [{ count: LISTED_DOC_COUNT }])
    dbChainMockFns.returning.mockResolvedValueOnce([CONNECTOR])
    mockListDocuments.mockResolvedValue({
      documents: ownedDocs.slice(0, LISTED_DOC_COUNT).map((d) => ({
        externalId: d.externalId,
        title: d.externalId,
        content: 'body',
        contentHash: 'h',
        mimeType: 'text/plain',
        metadata: {},
      })),
      hasMore: false,
    })
  }

  it('hard-deletes in heartbeat-separated chunks instead of one unbeaten call', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { hardDeleteDocuments } = await import('@/lib/knowledge/documents/service')

    primeReconciliation()
    vi.mocked(hardDeleteDocuments).mockResolvedValue(0)

    await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
      fullSync: true,
    })

    const calls = vi.mocked(hardDeleteDocuments).mock.calls
    expect(calls.length).toBeGreaterThan(1)

    /**
     * `hardDeleteDocuments` deletes storage objects, embeddings, and rows in
     * serialized transactions, and a forced `fullSync` overriding a listing cap
     * can hand it tens of thousands of ids. Passing the whole set was one await
     * spanning the widest gap between heartbeats in the sync, so the reaper saw
     * a working purge as a dead run.
     */
    for (const call of calls) {
      expect((call[0] as string[]).length).toBeLessThanOrEqual(25)
    }
    expect(calls.flatMap((call) => call[0] as string[])).toEqual(missingIds)
  })

  it('bounds and orders the stuck-document sweep instead of draining a backlog at once', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { STUCK_RETRY_MAX_CANDIDATES_PER_SYNC } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const { hardDeleteDocuments } = await import('@/lib/knowledge/documents/service')

    primeReconciliation()
    vi.mocked(hardDeleteDocuments).mockResolvedValue(0)
    /**
     * Every batch and the post-batch check re-read the connector to confirm the
     * sync target still exists; without enough rows the run exits as
     * connector-deleted before the sweep it is meant to exercise.
     */
    for (let i = 0; i < 40; i++) {
      queueTableRows(schemaMock.knowledgeConnector, [
        { connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    }
    // The sweep's own candidate read: no stuck documents, so it dispatches none.
    queueTableRows(schemaMock.document, [])

    await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
      fullSync: true,
    })

    /**
     * The dispatch loop's chunk size paced the sweep but never bounded it — the
     * candidate query had no limit, so one connector enqueued its entire backlog
     * (2,959 documents in fifteen seconds) onto the queue every workspace shares.
     */
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(STUCK_RETRY_MAX_CANDIDATES_PER_SYNC)
    /**
     * Ordered, so the bound takes the most overdue documents first and can never
     * starve one indefinitely. An unordered limit takes an arbitrary subset each
     * sync, which is a cap that silently loses work rather than deferring it.
     */
    expect(dbChainMockFns.orderBy).toHaveBeenCalled()
  })

  it('leaves an OAuth connector with no credential unscheduled instead of walking the failure ladder', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')

    queueTableRows(schemaMock.knowledgeConnector, [
      { ...CONNECTOR, connectorType: 'oauth', credentialId: null, encryptedApiKey: null },
    ])
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1', userId: 'u-1', workspaceId: 'ws-1' }])

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })

    expect(result.skipReason).toBe('credential_missing')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        nextSyncAt: null,
        lastSyncError: 'Credential removed. Reconnect the connector to resume syncing.',
        syncLockToken: null,
        syncLockLeaseAt: null,
      })
    )
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: expect.any(Number) })
    )
  })

  it('releases the lock when it errors a connector whose knowledge base is gone', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')

    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(schemaMock.knowledgeBase, [])

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })

    /**
     * This write runs before the lock is taken but is unconditional on status,
     * so it can land on a row a previous run left `syncing`. Flipping status
     * without releasing the token and lease left a row that was neither locked
     * nor reclaimable — the reaper only looks at `syncing` rows.
     */
    expect(result.skipReason).toBe('knowledge_base_deleted')
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncLockToken: null,
        syncLockLeaseAt: null,
      })
    )
  })
})

describe('completeSyncLog ownership guard', () => {
  const RESULT = {
    docsAdded: 1,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }

  beforeEach(() => {
    resetDbChainMock()
  })

  it('requires the run to still hold the connector lock when closing as completed', async () => {
    const { completeSyncLog } = await import('@/lib/knowledge/connectors/sync-engine')

    await completeSyncLog('log-1', 'completed', RESULT, { requireSyncLockOn: 'c-1' })

    /**
     * `status = 'started'` alone only defers to the sweep. A run stranded by any
     * other writer — the knowledge-base-deleted writers, a user pausing the
     * connector, a reclaim whose log-close committed separately — still has a
     * `started` row, so without this it publishes a `completed` outcome whose
     * connector bookkeeping was discarded.
     */
    const outerWhere = dbChainMockFns.where.mock.calls[1][0]
    expect(hasMockCondition(outerWhere, (node: MockCondition) => node.type === 'exists')).toBe(true)

    // The subquery's own predicate, built before the outer where is assembled.
    const subqueryWhere = dbChainMockFns.where.mock.calls[0][0]
    expect(
      hasMockCondition(
        subqueryWhere,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.syncLockToken &&
          node.right === 'log-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        subqueryWhere,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.status &&
          node.right === 'syncing'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        subqueryWhere,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.id &&
          node.right === 'c-1'
      )
    ).toBe(true)
    /**
     * Reuses `stillHoldsSyncLock`, not ownership alone, so the log row and the
     * connector row are written under exactly the same condition. Ownership-only
     * would let a connector archived mid-run publish a `completed` row for a
     * terminal write that was refused — the same mismatch, differently triggered.
     */
    expect(
      hasMockCondition(
        subqueryWhere,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
      )
    ).toBe(true)
  })
})

describe('executeSync terminal exits under a lost lock', () => {
  const CONNECTOR = {
    id: 'c-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'paged',
    credentialId: null,
    encryptedApiKey: null,
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    accessMode: 'workspace',
    status: 'active',
    lastSyncAt: null,
    lastSyncDocCount: 0,
    consecutiveFailures: 0,
    syncLockToken: null,
  }

  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(() => {
    resetDbChainMock()
  })

  /** Queues the connector, its knowledge base, and the lock CAS. */
  function primeLockedRun() {
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1', accessMode: 'workspace' }])
  }

  it('skips the success state write when the terminal knowledge-base lock is refused', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')

    primeLockedRun()
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          id: 'c-1',
          connectorArchivedAt: null,
          connectorDeletedAt: null,
          kbDeletedAt: null,
        },
      ])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [
      { ownedCount: 0, listedCount: 0, softCount: 0, hardCount: 0 },
    ])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    mockListDocuments.mockResolvedValue({ documents: [], hasMore: false })

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })

    expect(result.skipReason).toBe('sync_superseded')

    /**
     * Refusing the first terminal lock prevents the completed log and connector
     * state from becoming visible independently.
     */
    expect(dbChainMockFns.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', consecutiveFailures: 0 })
    )
    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
  })
})
