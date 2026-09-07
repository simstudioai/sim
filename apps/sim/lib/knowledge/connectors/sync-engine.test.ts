/**
 * @vitest-environment node
 */
import {
  authOAuthUtilsMock,
  dbChainMockFns,
  drizzleOrmMock,
  flattenMockConditions,
  hasMockCondition,
  type MockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { generateShortId } from '@sim/utils/id'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isConnectorRunnableStatus } from '@/lib/knowledge/connectors/sync-engine'
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

vi.mock('drizzle-orm', () => drizzleOrmMock)
const { mockProcessDocumentsWithQueue, mockUploadFile } = vi.hoisted(() => ({
  mockProcessDocumentsWithQueue: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: vi.fn(),
  isTriggerAvailable: vi.fn(),
  processDocumentAsync: vi.fn(),
  processDocumentsWithQueue: mockProcessDocumentsWithQueue,
}))
vi.mock('@/lib/uploads', () => ({ StorageService: { uploadFile: mockUploadFile } }))
const { mockDeleteFile, mockDeleteFileMetadata } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockDeleteFileMetadata: vi.fn(),
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mockDeleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: mockDeleteFileMetadata }))
vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/background/knowledge-connector-sync', () => ({
  knowledgeConnectorSync: { trigger: vi.fn() },
}))

const { mockGetDocument, mockMapTags, mockListDocuments } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockMapTags: vi.fn(),
  mockListDocuments: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionOwner: vi.fn(),
  assertBillingAttributionSnapshot: (snapshot: unknown) => snapshot,
}))

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
  },
}))

describe('isConnectorRunnableStatus', () => {
  it.each(['active', 'error'])('allows automatic sync from %s', (status) => {
    expect(isConnectorRunnableStatus(status)).toBe(true)
  })

  it.each(['paused', 'disabled', 'syncing'])('blocks automatic sync from %s', (status) => {
    expect(isConnectorRunnableStatus(status)).toBe(false)
  })
})

describe('shouldRunIncrementalSync', () => {
  const lastSyncAt = '2026-07-01T00:00:00.000Z'

  it('runs incrementally when everything is eligible', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      shouldRunIncrementalSync(true, 'incremental', undefined, undefined, false, lastSyncAt)
    ).toBe(true)
  })

  it('never runs incrementally when the connector does not support it', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      shouldRunIncrementalSync(false, 'incremental', undefined, undefined, false, lastSyncAt)
    ).toBe(false)
  })

  it('never runs incrementally when the connector is configured for full syncs', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(shouldRunIncrementalSync(true, 'full', undefined, undefined, false, lastSyncAt)).toBe(
      false
    )
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

  it('never runs incrementally before the first sync', async () => {
    const { shouldRunIncrementalSync } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(shouldRunIncrementalSync(true, 'incremental', undefined, undefined, false, null)).toBe(
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

describe('resolveTagMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps semantic keys to DB slots', async () => {
    mockMapTags.mockReturnValue({
      issueType: 'Bug',
      status: 'Open',
      priority: 'High',
    })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping(
      'jira',
      { issueType: 'Bug', status: 'Open', priority: 'High' },
      {
        tagSlotMapping: {
          issueType: 'tag1',
          status: 'tag2',
          priority: 'tag3',
        },
      }
    )

    expect(result).toEqual({
      tag1: 'Bug',
      tag2: 'Open',
      tag3: 'High',
    })
  })

  it('returns undefined when connector has no mapTags', async () => {
    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping(
      'no-tags',
      { key: 'value' },
      {
        tagSlotMapping: { key: 'tag1' },
      }
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when connector type is unknown', async () => {
    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping('unknown', { key: 'value' }, {})

    expect(result).toBeUndefined()
  })

  it('returns undefined when no tagSlotMapping in sourceConfig', async () => {
    mockMapTags.mockReturnValue({ issueType: 'Bug' })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping('jira', { issueType: 'Bug' }, {})

    expect(result).toBeUndefined()
  })

  it('sets null for missing metadata keys', async () => {
    mockMapTags.mockReturnValue({
      issueType: 'Bug',
      status: undefined,
    })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping(
      'jira',
      { issueType: 'Bug' },
      {
        tagSlotMapping: {
          issueType: 'tag1',
          status: 'tag2',
          missing: 'tag3',
        },
      }
    )

    expect(result).toEqual({
      tag1: 'Bug',
      tag2: null,
      tag3: null,
    })
  })

  it('returns undefined when sourceConfig is undefined', async () => {
    mockMapTags.mockReturnValue({ issueType: 'Bug' })

    const { resolveTagMapping } = await import('@/lib/knowledge/connectors/sync-persistence')

    const result = resolveTagMapping('jira', { issueType: 'Bug' }, undefined)

    expect(result).toBeUndefined()
  })
})

describe('classifyExternalDoc', () => {
  const base = { content: 'hello', contentDeferred: false, contentHash: 'h1' }

  it('records a new skipped file as a failed row', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    expect(
      classifyExternalDoc({ ...base, content: '', skippedReason: 'too big' }, undefined)
    ).toEqual({ type: 'skip' })
  })

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

  it('refreshes an existing skipped placeholder without turning it into a source failure', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(
      classifyExternalDoc(
        { ...base, content: '', skippedReason: 'too big' },
        { id: 'doc-1', contentHash: 'old', storageKey: null }
      )
    ).toEqual({ type: 'skip', existingId: 'doc-1' })
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

  it('uses the same skip replacement rule after deferred hydration', async () => {
    const { shouldReplaceExistingWithSkippedDocument } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(shouldReplaceExistingWithSkippedDocument({ storageKey: null }, {})).toBe(true)
    expect(shouldReplaceExistingWithSkippedDocument({ storageKey: 'kb/indexed.txt' }, {})).toBe(
      false
    )
    expect(
      shouldReplaceExistingWithSkippedDocument(
        { storageKey: 'kb/indexed.txt' },
        { skippedExistingDisposition: 'replace' }
      )
    ).toBe(true)
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

  it('drops empty non-deferred content', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    expect(classifyExternalDoc({ ...base, content: '   ' }, undefined)).toEqual({ type: 'drop' })
  })

  it('adds new content and deferred stubs', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    expect(classifyExternalDoc(base, undefined)).toEqual({ type: 'add' })
    expect(classifyExternalDoc({ ...base, content: '', contentDeferred: true }, undefined)).toEqual(
      { type: 'add' }
    )
  })

  it('updates when the content hash changed and is unchanged otherwise', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'old' })).toEqual({
      type: 'update',
      existingId: 'doc-1',
    })
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'h1' })).toEqual({
      type: 'unchanged',
    })
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

  it('does not force re-hydration of a non-deferred doc (content already final)', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    // Ready (non-deferred) content with an unchanged hash stays unchanged even under forceRehydrate.
    expect(classifyExternalDoc(base, { id: 'doc-1', contentHash: 'h1' }, true)).toEqual({
      type: 'unchanged',
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
    vi.clearAllMocks()
    resetDbChainMock()
    mockUploadFile.mockResolvedValue({
      key: 'kb/new-document.txt',
      path: '/api/files/serve/kb/new-document.txt',
    })
    mockProcessDocumentsWithQueue.mockResolvedValue({ requested: 1, accepted: 1, failed: 0 })
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
    queueTableRows(schemaMock.document, [
      { fileUrl: '/api/files/serve/kb/old-document.txt?context=knowledge-base' },
    ])
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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The heartbeat before a batch only proves the lease was held then; the
   * write itself re-proves it inside its transaction, so a run reclaimed in
   * between lands nothing over its replacement's.
   */
  it('refuses to write once the run no longer holds its lease', async () => {
    const { persistSkippedDocuments } = await import('@/lib/knowledge/connectors/sync-persistence')
    const { SyncLockLostException } = await import('@/lib/knowledge/connectors/sync-lock')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(
      persistSkippedDocuments(
        'kb-1',
        'connector-1',
        'no-tags',
        [
          {
            type: 'skip',
            extDoc: {
              externalId: 'external-1',
              title: 'Empty document',
              content: '',
              mimeType: 'text/plain',
              contentHash: 'empty-hash',
              skippedReason: 'Document contains no extractable text',
            },
          },
        ],
        undefined,
        'workspace',
        lease
      )
    ).rejects.toBeInstanceOf(SyncLockLostException)

    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
  })

  it('persists a new skipped document without dispatching processing', async () => {
    const { persistSkippedDocuments } = await import('@/lib/knowledge/connectors/sync-persistence')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])

    await expect(
      persistSkippedDocuments(
        'kb-1',
        'connector-1',
        'no-tags',
        [
          {
            type: 'skip',
            extDoc: {
              externalId: 'external-1',
              title: 'Empty document',
              content: '',
              mimeType: 'text/plain',
              contentHash: 'empty-hash',
              skippedReason: 'Document contains no extractable text',
              skippedExistingDisposition: 'replace',
            },
          },
        ],
        undefined,
        'workspace',
        lease
      )
    ).resolves.toHaveLength(1)

    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        connectorId: 'connector-1',
        externalId: 'external-1',
        storageKey: null,
        processingStatus: 'failed',
        contentHash: 'empty-hash',
      }),
    ])
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('atomically replaces stale indexed content for an authoritative skip', async () => {
    const { persistSkippedDocuments } = await import('@/lib/knowledge/connectors/sync-persistence')
    const oldFileUrl = '/api/files/serve/kb/old-document.txt?context=knowledge-base'
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    queueTableRows(schemaMock.document, [{ fileUrl: oldFileUrl }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

    await expect(
      persistSkippedDocuments(
        'kb-1',
        'connector-1',
        'no-tags',
        [
          {
            type: 'skip',
            existingId: 'doc-1',
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
    ).resolves.toHaveLength(1)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        fileUrl: '',
        storageKey: null,
        processingStatus: 'failed',
        processingError: 'Document contains no extractable text',
        processingQueuedAt: null,
        processingQueueToken: null,
        processingDeferredUntil: null,
        processingAttempts: 0,
        chunkCount: 0,
        contentHash: 'new-empty-hash',
        deletedAt: null,
      })
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.embedding)
    expect(mockDeleteFile).toHaveBeenCalledWith({
      key: 'kb/old-document.txt',
      context: 'knowledge-base',
    })
    expect(mockDeleteFileMetadata).toHaveBeenCalledWith('kb/old-document.txt')
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

describe('persistSkippedRetryHashes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('updates only the retry hash for a last-known-good connector document', async () => {
    const { classifyExternalDoc } = await import('@/lib/knowledge/connectors/sync-primitives')
    const { persistSkippedRetryHashes } = await import(
      '@/lib/knowledge/connectors/sync-persistence'
    )
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'doc-1' }])

    await expect(
      persistSkippedRetryHashes(
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

  it('commits live retry hashes when another document is no longer a connector target', async () => {
    const { persistSkippedRetryHashes } = await import(
      '@/lib/knowledge/connectors/sync-persistence'
    )
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'live-doc' }]).mockResolvedValueOnce([])

    await expect(
      persistSkippedRetryHashes(
        'kb-1',
        'connector-1',
        [
          {
            existingId: 'live-doc',
            externalId: 'live-page',
            contentHash: 'notion:retry:v1:live-page',
          },
          {
            existingId: 'detached-doc',
            externalId: 'detached-page',
            contentHash: 'notion:retry:v1:detached-page',
          },
        ],
        lease
      )
    ).resolves.toEqual(['detached-page'])

    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      contentHash: 'notion:retry:v1:live-page',
    })
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

  it('batches small ops up to the count cap', async () => {
    const { chunkOpsByByteBudget } = await import('@/lib/knowledge/connectors/sync-primitives')
    const chunks = chunkOpsByByteBudget(
      Array.from({ length: 7 }, () => addOp(1024)),
      64 * MB,
      5
    )
    expect(chunks.map((c) => c.length)).toEqual([5, 2])
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
    vi.clearAllMocks()
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
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    queueTableRows(schemaMock.knowledgeConnector, [CONNECTOR])
    for (let i = 0; i < 20; i++)
      queueTableRows(schemaMock.knowledgeConnector, [
        { id: 'c-1', connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
      ])
    queueTableRows(schemaMock.knowledgeBase, [{ userId: 'u-1', workspaceId: 'ws-1' }])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.document, [])
    queueTableRows(schemaMock.knowledgeConnector, [
      { connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([CONNECTOR])
  })

  afterEach(() => {
    vi.useRealTimers()
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
      docsAdded: 0,
      docsFailed: 0,
      error: rateLimitError.message,
    })
    expect(mockUploadFile).not.toHaveBeenCalled()
    expect(mockProcessDocumentsWithQueue).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        consecutiveFailures: 0,
      })
    )
    const failureUpdate = dbChainMockFns.set.mock.calls.find(
      ([update]) => update.status === 'error'
    )?.[0]
    expect(failureUpdate?.nextSyncAt.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + 45 * 60 * 1000
    )
    expect(failureUpdate?.nextSyncAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 46 * 60 * 1000)
  })
})

describe('previous complete listing evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  it('trusts a healthy listing', () => {
    expect(classifySuspectListing(100, 100)).toBeNull()
    expect(classifySuspectListing(90, 100)).toBeNull()
  })

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

  it('leaves a healthy listing untouched', () => {
    expect(evaluateListingSafety(100, 100, null, undefined)).toEqual({
      reason: null,
      blocked: false,
      corroborated: false,
    })
  })

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

  it('blocks then allows a proportional collapse across two syncs', () => {
    expect(evaluateListingSafety(3, 10_000, previous(10_000, 10_000), undefined).blocked).toBe(true)
    expect(evaluateListingSafety(3, 10_000, previous(2, 10_000), undefined)).toEqual({
      reason: 'collapsed',
      blocked: false,
      corroborated: true,
    })
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

  it('carries the source file and clears the deferred flag', () => {
    const merged = mergeHydratedDocument(
      stub(),
      { ...stub(), sourceFile: { bytes: Buffer.from('x'), fileName: 'a.pdf', mimeType: 'a/b' } },
      'h'
    )

    expect(merged.sourceFile?.bytes.toString()).toBe('x')
    expect(merged.contentDeferred).toBe(false)
    expect(merged.contentHash).toBe('h')
  })

  it('keeps text-path content and merges metadata over the stub', () => {
    const merged = mergeHydratedDocument(
      stub(),
      { ...stub(), content: 'plain notes', metadata: { createdBy: 'A' } },
      'h'
    )

    expect(merged.content).toBe('plain notes')
    expect(merged.sourceFile).toBeUndefined()
    expect(merged.metadata).toEqual({ fileSize: 2_400_000, createdBy: 'A' })
  })

  it('falls back to the stub title and sourceUrl when hydration omits them', () => {
    const merged = mergeHydratedDocument(
      { ...stub(), sourceUrl: 'https://example.com/a' },
      { ...stub(), title: '', content: 'x' },
      'h'
    )

    expect(merged.title).toBe('Report.pdf')
    expect(merged.sourceUrl).toBe('https://example.com/a')
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

  it('persists an explicit connector retry hash for a skipped hydration', () => {
    const listed: ExternalDocument = {
      externalId: 'page-1',
      title: 'Restricted page',
      content: '',
      contentDeferred: true,
      mimeType: 'text/markdown',
      contentHash: 'notion:v3:page-1:unchanged',
    }
    const skipped: ExternalDocument = {
      ...listed,
      contentDeferred: false,
      skippedReason: 'Nested block is inaccessible',
      skippedRetryContentHash: 'notion:retry:v1:page-1',
    }

    expect(mergeHydratedSkippedDocument(listed, skipped).contentHash).toBe('notion:retry:v1:page-1')
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

  it('passes through a hydrated document', async () => {
    const { requireHydratedListedDocument } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const hydrated: ExternalDocument = {
      externalId: 'listed-1',
      title: 'Listed',
      content: 'body',
      mimeType: 'text/plain',
    }

    expect(requireHydratedListedDocument(hydrated, 'listed-1')).toBe(hydrated)
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

  it('counts one document once if multiple unusable signals converge', async () => {
    const { recordUnverifiedExistingRefresh } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )
    const result = { docsFailed: 0 }
    const failedExternalIds = new Set<string>()

    recordUnverifiedExistingRefresh(result, failedExternalIds, 'existing-1')
    recordUnverifiedExistingRefresh(result, failedExternalIds, 'existing-1')

    expect(result).toEqual({ docsFailed: 1 })
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

  it('leaves a document dispatched by the previous sync and still queued alone', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES - 1) }),
        now
      )
    ).toBe(false)
  })

  it('leaves a document the sweep itself re-dispatched alone while it waits', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: minutesBefore(GRACE_MINUTES - 1),
          uploadedAt: minutesBefore(60 * 48),
        }),
        now
      )
    ).toBe(false)
  })

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

  it('holds a queued document at the grace boundary', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', { uploadedAt: minutesBefore(GRACE_MINUTES) }),
        now
      )
    ).toBe(false)
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

  it('reclaims a failed document once no retry of it can still be live', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
  })

  it('holds a failed document at the grace boundary', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingCompletedAt: minutesBefore(GRACE_MINUTES) }),
        now
      )
    ).toBe(false)
  })

  it('falls back to the dispatch stamp when a failed row never recorded completion', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingQueuedAt: minutesBefore(1), uploadedAt: minutesBefore(1) }),
        now
      )
    ).toBe(false)
    expect(
      isStuckDocumentSweepEligible(
        candidate('failed', { processingQueuedAt: minutesBefore(GRACE_MINUTES + 1) }),
        now
      )
    ).toBe(true)
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

  it('reclaims a processing document with no start time', () => {
    expect(isStuckDocumentSweepEligible(candidate('processing'), now)).toBe(true)
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

  it('gives a document whose content was just updated the full grace period', () => {
    expect(
      isStuckDocumentSweepEligible(
        candidate('pending', {
          processingQueuedAt: null,
          processingStartedAt: minutesBefore(60 * 48),
          uploadedAt: minutesBefore(5),
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

  it.each([
    {
      name: 'fresh queue generation',
      stale: { processingStatus: 'pending', ...oldCandidate },
      fresh: {
        processingStatus: 'pending',
        ...oldCandidate,
        processingQueuedAt: minutesBefore(1),
      },
    },
    {
      name: 'fresh processing claim',
      stale: {
        processingStatus: 'processing',
        ...oldCandidate,
        processingStartedAt: minutesBefore(60),
      },
      fresh: {
        processingStatus: 'processing',
        ...oldCandidate,
        processingStartedAt: minutesBefore(1),
      },
    },
    {
      name: 'live quota continuation',
      stale: {
        processingStatus: 'pending',
        ...oldCandidate,
        processingDeferredUntil: minutesBefore(300),
      },
      fresh: {
        processingStatus: 'pending',
        ...oldCandidate,
        processingDeferredUntil: minutesBefore(1),
      },
    },
    {
      name: 'fresh failed attempt',
      stale: {
        processingStatus: 'failed',
        ...oldCandidate,
        processingCompletedAt: minutesBefore(300),
      },
      fresh: {
        processingStatus: 'failed',
        ...oldCandidate,
        processingCompletedAt: minutesBefore(1),
      },
    },
  ])(
    'drops a formerly eligible candidate after its locked reread sees a $name',
    ({ stale, fresh }) => {
      expect(
        selectStuckDocumentSweepCandidates([{ id: 'doc-1', ...stale }], now).map((doc) => doc.id)
      ).toEqual(['doc-1'])
      expect(selectStuckDocumentSweepCandidates([{ id: 'doc-1', ...fresh }], now)).toEqual([])
    }
  )

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

  it('keeps the recorded count when it is the larger observation', async () => {
    const { resolvePreviousOwnedCount } = await import('@/lib/knowledge/connectors/sync-primitives')

    expect(resolvePreviousOwnedCount(800, 500)).toBe(800)
    expect(resolvePreviousOwnedCount(500, 500)).toBe(500)
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

describe('buildReconciliationHoldNotice', () => {
  it('places each count in its own role', async () => {
    const { buildReconciliationHoldNotice } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    /**
     * Asserted whole rather than by three independent `toContain` checks on
     * distinct digit strings: those passed even with the first two arguments
     * swapped, which inverts the message into "withheld 250 — more than the 500
     * allowed" and misleads the operator it exists to inform.
     */
    expect(buildReconciliationHoldNotice(500, 250, 1000, true, false)).toBe(
      'Withheld 500 document removal(s) — more than the 250 allowed per generation ' +
        'in one sync of 1000 documents. Documents removed at the source are still indexed. ' +
        'Check the source is returning its full contents, then run a full sync to apply the removals.'
    )
  })

  it('does not claim withheld documents are indexed when only the purge was held', async () => {
    const { buildReconciliationHoldNotice } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    /**
     * A hard-only hold withholds documents a previous sync already tombstoned,
     * so they have been invisible since then. Telling the operator they are
     * "still indexed" was simply false.
     */
    const notice = buildReconciliationHoldNotice(500, 250, 1000, false, true)

    expect(notice).toContain('already pending removal were not purged')
    expect(notice).not.toContain('are still indexed')
  })

  it('names both consequences when both generations were held', async () => {
    const { buildReconciliationHoldNotice } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    const notice = buildReconciliationHoldNotice(900, 250, 1000, true, true)

    expect(notice).toContain('are still indexed')
    expect(notice).toContain('already pending removal were not purged')
  })

  it('describes the cap as per generation, since a sync may spend it twice', async () => {
    const { buildReconciliationHoldNotice } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    // Saying "allowed in one sync" understated the real ceiling by 2x.
    expect(buildReconciliationHoldNotice(500, 250, 1000, true, false)).toContain(
      '250 allowed per generation'
    )
  })

  it('cannot be satisfied by swapping the withheld and cap counts', async () => {
    const { buildReconciliationHoldNotice } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    expect(buildReconciliationHoldNotice(500, 250, 1000, true, false)).not.toBe(
      buildReconciliationHoldNotice(250, 500, 1000, true, false)
    )
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

  it('treats a null counter as a first failure', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(buildSyncFailureUpdate(now, null, 'boom').consecutiveFailures).toBe(1)
    expect(buildSyncFailureUpdate(now, undefined, 'boom').nextSyncAt).toEqual(minutesAfter(30))
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

  it('releases the ownership token on both outcomes', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const { MAX_CONSECUTIVE_FAILURES } = await import('@/lib/knowledge/connectors/sync-limits')

    expect(buildSyncFailureUpdate(now, 0, 'boom').syncLockToken).toBeNull()
    expect(buildSyncFailureUpdate(now, MAX_CONSECUTIVE_FAILURES, 'boom').syncLockToken).toBeNull()
  })

  it('closes the lock lease alongside the token', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    /**
     * A run that ends leaves no lease behind. Otherwise the reaper waits out a
     * full TTL against a lease belonging to a run that is already over.
     */
    expect(buildSyncFailureUpdate(now, 0, 'boom').syncLockLeaseAt).toBeNull()
  })

  it('sources the auto-disabled message from the constant the reaper shares', async () => {
    const { buildSyncFailureUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const { CONNECTOR_AUTO_DISABLED_ERROR, MAX_CONSECUTIVE_FAILURES } = await import(
      '@/lib/knowledge/connectors/sync-limits'
    )

    // Two writers advance one verdict; a second copy of the wording lets the
    // in-process breaker and the SQL breaker disagree about what happened.
    expect(buildSyncFailureUpdate(now, MAX_CONSECUTIVE_FAILURES, 'boom').lastSyncError).toBe(
      CONNECTOR_AUTO_DISABLED_ERROR
    )
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

  it('caps the provider deadline and releases the sync lease', async () => {
    const { buildSyncRateLimitUpdate } = await import('@/lib/knowledge/connectors/sync-engine')
    const update = buildSyncRateLimitUpdate(now, 4, 'rate limited', 30 * 24 * 60 * 60 * 1000)

    expect(update.nextSyncAt).toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1000))
    expect(update.syncLockToken).toBeNull()
    expect(update.syncLockLeaseAt).toBeNull()
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

describe('sync lock lease', () => {
  const now = new Date('2026-08-20T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('opens the lease in the same statement that takes the lock', async () => {
    const { buildSyncLockAcquisition } = await import('@/lib/knowledge/connectors/sync-lock')

    const values = buildSyncLockAcquisition('log-1', now)

    // A lease opened after the lock leaves a window where the reaper reads a
    // NULL lease and falls back to a stale `updatedAt`.
    expect(values.syncLockLeaseAt).toEqual(now)
    expect(values.syncLockToken).toBe('log-1')
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

  it('still clears lastSyncError on an ordinary successful sync', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(buildSyncSuccessUpdate(now, 42, null, null).lastSyncError).toBeNull()
  })

  it('closes the lock lease alongside the token', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    const update = buildSyncSuccessUpdate(now, 42, null, null)

    expect(update.syncLockToken).toBeNull()
    expect(update.syncLockLeaseAt).toBeNull()
  })

  it('does not treat a held pass as a broken connector', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    const update = buildSyncSuccessUpdate(now, 42, null, 'held')

    expect(update.status).toBe('active')
    expect(update.consecutiveFailures).toBe(0)
  })

  it('preserves the incremental watermark when source work failed', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    const update = buildSyncSuccessUpdate(now, 42, null, null, false)

    expect(update).not.toHaveProperty('lastSyncAt')
    expect(update.status).toBe('active')
    expect(update.nextSyncAt).toBeNull()
  })
})

describe('completeSyncLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('only writes a row that is still started', async () => {
    const { completeSyncLog } = await import('@/lib/knowledge/connectors/sync-engine')

    await completeSyncLog('log-1', 'completed', {
      docsAdded: 1,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
    })

    const where = dbChainMockFns.where.mock.calls[0][0]
    /**
     * Without this the sweep and a late-finishing in-process run race: the sweep
     * marks the row failed, then the run overwrites it as completed.
     */
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnectorSyncLog.status &&
          node.right === 'started'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnectorSyncLog.id &&
          node.right === 'log-1'
      )
    ).toBe(true)
  })

  it('persists skipped and failed source outcomes separately', async () => {
    const { completeSyncLog } = await import('@/lib/knowledge/connectors/sync-engine')

    await completeSyncLog('log-1', 'completed', {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 3,
      docsFailed: 2,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ docsSkipped: 3, docsFailed: 2 })
    )
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
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('commits the completed log and connector state in one guarded transaction', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')

    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.document, [{ count: 4 }])
    dbChainMockFns.returning
      /** The workspace ACL restore finds nothing drifted. */
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])

    await expect(completeSuccessfulSync('c-1', 'kb-1', 'log-1', 60, RESULT, null)).resolves.toBe(
      true
    )

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', docsFailed: 1 })
    )
    const connectorUpdate = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.status === 'active'
    )?.[0] as Record<string, unknown> | undefined
    expect(connectorUpdate).toBeDefined()
    expect(connectorUpdate).not.toHaveProperty('lastSyncAt')
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

  it('retains an earlier worker content failure when the final page has no errors', async () => {
    const { completeSuccessfulSync } = await import('@/lib/knowledge/connectors/sync-engine')
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb-1' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.document, [{ count: 4 }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'log-1' }])
      .mockResolvedValueOnce([{ id: 'c-1' }])

    expect(
      await completeSuccessfulSync(
        'c-1',
        'kb-1',
        'log-1',
        60,
        { ...RESULT, docsFailed: 0 },
        'retry',
        {
          complete: true,
          checkpoint: {
            unsafe: false,
            contentFailures: true,
            startedAt: '2026-09-04T00:00:00Z',
            listedCount: 4,
          },
        }
      )
    ).toBe(true)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial', docsFailed: 0, listedCount: 4 })
    )
    const connectorUpdate = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.status === 'active'
    )?.[0] as Record<string, unknown>
    expect(connectorUpdate).not.toHaveProperty('lastSyncAt')
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

  it('still scopes to the connector and skips archived or deleted rows', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    const condition = stillHoldsSyncLock('c-1', 'run-a')

    expect(
      hasMockCondition(
        condition,
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.knowledgeConnector.id &&
          node.right === 'c-1'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        condition,
        (node: MockCondition) =>
          node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.deletedAt
      )
    ).toBe(true)
  })
})

describe('writeTerminalConnectorState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('passes the caller values through untouched', async () => {
    const { writeTerminalConnectorState } = await import('@/lib/knowledge/connectors/sync-engine')

    const values = { status: 'error', consecutiveFailures: 4, nextSyncAt: null }
    await writeTerminalConnectorState('c-1', 'run-a', values)

    expect(dbChainMockFns.set.mock.calls[0][0]).toEqual(values)
  })

  it('reports whether the write landed', async () => {
    const { writeTerminalConnectorState } = await import('@/lib/knowledge/connectors/sync-engine')

    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'c-1' }])
    expect(await writeTerminalConnectorState('c-1', 'run-a', { status: 'active' })).toBe(true)

    dbChainMockFns.returning.mockResolvedValueOnce([])
    expect(await writeTerminalConnectorState('c-1', 'run-a', { status: 'active' })).toBe(false)
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

  it('preserves the document counters of the discarded run', async () => {
    const { markSyncSuperseded } = await import('@/lib/knowledge/connectors/sync-engine')

    // Those writes landed — only the connector-level bookkeeping was discarded.
    expect(markSyncSuperseded(result)).toMatchObject(result)
  })

  it('does not mutate the result it was handed', async () => {
    const { markSyncSuperseded } = await import('@/lib/knowledge/connectors/sync-engine')

    markSyncSuperseded(result)

    expect(result).not.toHaveProperty('error')
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

  it('rejects a run whose lock was reclaimed with no replacement yet', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    const reclaimed = {
      ...rowHeldByB,
      [schemaMock.knowledgeConnector.status]: 'error',
      [schemaMock.knowledgeConnector.syncLockToken]: null,
    }

    expect(conditionMatchesRow(stillHoldsSyncLock('c-1', RUN_A), reclaimed)).toBe(false)
  })

  it('admits the run that still holds its own lock', async () => {
    const { stillHoldsSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    const heldByA = { ...rowHeldByB, [schemaMock.knowledgeConnector.syncLockToken]: RUN_A }

    expect(conditionMatchesRow(stillHoldsSyncLock('c-1', RUN_A), heldByA)).toBe(true)
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

  it('releases the token when a run writes its terminal success state', async () => {
    const { buildSyncSuccessUpdate } = await import('@/lib/knowledge/connectors/sync-engine')

    // A stale token left behind could match a later run reusing the same id.
    expect(buildSyncSuccessUpdate(new Date(), 1, null, null).syncLockToken).toBeNull()
  })
})

describe('buildSyncLockAcquisition', () => {
  it('claims the lock and stamps ownership in one payload', async () => {
    const { buildSyncLockAcquisition } = await import('@/lib/knowledge/connectors/sync-lock')

    const now = new Date('2026-08-20T00:00:00.000Z')
    const acquisition = buildSyncLockAcquisition('run-a', now)

    /**
     * Without the token here every terminal write would fail to match its own
     * run, so every sync would report superseded and leave the connector stuck
     * `syncing` until the reaper cleared it.
     */
    expect(acquisition.syncLockToken).toBe('run-a')
    expect(acquisition.status).toBe('syncing')
  })
})

describe('LOCKABLE_CONNECTOR_STATUSES', () => {
  it('refuses to start a run on a connector someone paused or disabled', async () => {
    const { LOCKABLE_CONNECTOR_STATUSES } = await import('@/lib/knowledge/connectors/sync-lock')

    /**
     * The queue outlives the decision to sync. A connector paused *after* its
     * run was queued still has a task in flight, and a bare not-syncing test
     * let that task take the lock and then write `active` over the pause — so
     * one pause during the queue window was silently undone. The dispatch-side
     * guards cannot see a status change that happens after they ran; this CAS
     * is the only point that can.
     */
    expect(LOCKABLE_CONNECTOR_STATUSES).not.toContain('paused')
    expect(LOCKABLE_CONNECTOR_STATUSES).not.toContain('disabled')

    /** A queued run must still be lockable, or nothing would ever sync. */
    expect(LOCKABLE_CONNECTOR_STATUSES).toContain('pending')
    expect(LOCKABLE_CONNECTOR_STATUSES).toContain('active')
    expect(LOCKABLE_CONNECTOR_STATUSES).toContain('error')

    /** `syncing` is already locked; re-locking it would strand the live run. */
    expect(LOCKABLE_CONNECTOR_STATUSES).not.toContain('syncing')
  })
})

describe('shouldHeartbeatSyncLock', () => {
  it('beats once the interval has elapsed', async () => {
    const { shouldHeartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    expect(shouldHeartbeatSyncLock(1_000, 0, 1_000)).toBe(true)
    expect(shouldHeartbeatSyncLock(1_001, 0, 1_000)).toBe(true)
  })

  it('does not beat before the interval has elapsed', async () => {
    const { shouldHeartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    expect(shouldHeartbeatSyncLock(999, 0, 1_000)).toBe(false)
    expect(shouldHeartbeatSyncLock(0, 0, 1_000)).toBe(false)
  })

  it('defaults to an interval far below the reclaim TTL', async () => {
    const { shouldHeartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')
    const { CONNECTOR_SYNC_STALE_LOCK_TTL_MS, SYNC_LOCK_HEARTBEAT_INTERVAL_MS } = await import(
      '@/lib/knowledge/connectors/sync-limits'
    )

    /**
     * A live run must beat many times over before the reclaim cutoff, or
     * ordinary jitter reclaims a working sync — which is what made the reaper a
     * one-way ratchet to `disabled` for slow in-process syncs.
     */
    expect(SYNC_LOCK_HEARTBEAT_INTERVAL_MS * 4).toBeLessThan(CONNECTOR_SYNC_STALE_LOCK_TTL_MS)
    expect(shouldHeartbeatSyncLock(SYNC_LOCK_HEARTBEAT_INTERVAL_MS, 0)).toBe(true)
    expect(shouldHeartbeatSyncLock(SYNC_LOCK_HEARTBEAT_INTERVAL_MS - 1, 0)).toBe(false)
  })
})

describe('heartbeatSyncLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('extends the lock lease alone, under the run own lock guard', async () => {
    const { heartbeatSyncLock } = await import('@/lib/knowledge/connectors/sync-lock')

    await heartbeatSyncLock('c-1', 'run-a')

    /**
     * Asserted whole, and the absence of `updatedAt` is the point. While the
     * beat wrote the row mtime, every unrelated write to the row — a config
     * edit, a status flip — was indistinguishable from a heartbeat and renewed
     * a wedged run's lease, pushing its recovery out by another full TTL.
     */
    expect(dbChainMockFns.set.mock.calls[0][0]).toEqual({
      syncLockLeaseAt: expect.any(Date),
    })

    // Guarded, so a beat doubles as an ownership probe rather than a blind touch.
    const where = dbChainMockFns.where.mock.calls[0][0]
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
    vi.clearAllMocks()
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

  it('beats between pages and abandons the run when the lock was reclaimed', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { SYNC_LOCK_HEARTBEAT_INTERVAL_MS } = await import(
      '@/lib/knowledge/connectors/sync-limits'
    )

    primeSyncUpToListing()

    /**
     * Listing is where a large source spends most of its wall clock, so a page
     * that pushes the run past the heartbeat interval must trigger a beat before
     * the next page — not only once listing has finished.
     */
    mockListDocuments.mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + SYNC_LOCK_HEARTBEAT_INTERVAL_MS + 1_000))
      return { documents: [], hasMore: true, nextCursor: 'page-2' }
    })

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
    })

    // Aborted on the beat before page 2 rather than paging on under a lost lock.
    expect(mockListDocuments).toHaveBeenCalledTimes(1)
    expect(result.skipReason).toBe('sync_superseded')
  })

  it('does not beat when pages return faster than the interval', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')

    primeSyncUpToListing()

    let pages = 0
    mockListDocuments.mockImplementation(async () => {
      pages += 1
      vi.setSystemTime(new Date(Date.now() + 1_000))
      return { documents: [], hasMore: pages < 3, nextCursor: `page-${pages}` }
    })

    await executeSync('c-1', { billingAttribution: { workspaceId: 'ws-1' } as never })

    // All three pages fetched: the time gate keeps a fast listing beat-free.
    expect(mockListDocuments).toHaveBeenCalledTimes(3)
  })
})

describe('resolveStaleProcessingMinutes', () => {
  it('preserves the previously hard-coded value at the default configuration', async () => {
    const { resolveStaleProcessingMinutes } = await import('@/lib/knowledge/connectors/sync-engine')

    expect(resolveStaleProcessingMinutes(600, 3)).toBe(45)
  })

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
  it('never includes a completed document', async () => {
    const { SWEEPABLE_PROCESSING_STATUSES } = await import(
      '@/lib/knowledge/connectors/sync-primitives'
    )

    /**
     * The sweep reclaims by deleting embeddings and re-dispatching, so a
     * completed document entering this list means a finished, already-billed
     * pass is discarded and paid for twice.
     */
    expect(SWEEPABLE_PROCESSING_STATUSES).not.toContain('completed')
    expect([...SWEEPABLE_PROCESSING_STATUSES].sort()).toEqual(['failed', 'pending', 'processing'])
  })

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

describe('MAX_PROCESSING_ATTEMPTS', () => {
  it('bounds sweep spend without stranding a recoverable document too early', async () => {
    const { MAX_PROCESSING_ATTEMPTS } = await import('@/lib/knowledge/documents/types')

    /**
     * One attempt is spent per dispatch, not per Trigger.dev retry, so a
     * short-interval connector can burn several inside one transient outage.
     * Below 4 that is reachable in a single bad window; above ~10 the budget
     * stops bounding the spend it exists to bound.
     */
    expect(MAX_PROCESSING_ATTEMPTS).toBeGreaterThanOrEqual(4)
    expect(MAX_PROCESSING_ATTEMPTS).toBeLessThanOrEqual(10)
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
    vi.clearAllMocks()
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

  it('stops deletion between chunks when the sync lock was reclaimed', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { SYNC_LOCK_HEARTBEAT_INTERVAL_MS } = await import(
      '@/lib/knowledge/connectors/sync-limits'
    )
    const { hardDeleteDocuments } = await import('@/lib/knowledge/documents/service')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'))
    primeReconciliation()
    vi.mocked(hardDeleteDocuments).mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + SYNC_LOCK_HEARTBEAT_INTERVAL_MS + 1))
      return 0
    })

    const result = await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
      fullSync: true,
    })

    expect(hardDeleteDocuments).toHaveBeenCalledTimes(1)
    expect(result.skipReason).toBe('sync_superseded')
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

  it('passes a transactional sync-lock guard to every hard-delete chunk', async () => {
    const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
    const { hardDeleteDocuments } = await import('@/lib/knowledge/documents/service')
    primeReconciliation()
    vi.mocked(hardDeleteDocuments).mockResolvedValue(0)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'c-1', accessMode: 'workspace' }])

    await executeSync('c-1', {
      billingAttribution: { workspaceId: 'ws-1' } as never,
      fullSync: true,
    })

    for (const call of vi.mocked(hardDeleteDocuments).mock.calls) {
      expect(call[4]).toEqual({
        connectorId: 'c-1',
        knowledgeBaseId: 'kb-1',
        syncLockToken: expect.any(String),
        lease: 'content',
      })
    }
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
    vi.clearAllMocks()
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

  it('leaves both failure closes unguarded', async () => {
    const { completeSyncLog } = await import('@/lib/knowledge/connectors/sync-engine')

    /**
     * A `failed` row is never read back as evidence —
     * `loadPreviousListingObservation` selects `status = 'completed'` — and both
     * failure paths legitimately close a run whose lock is already gone. The
     * deleted-connector path in particular runs on an archived row the reaper
     * skips, so guarding it would strand the log row instead of closing it.
     */
    await completeSyncLog('log-1', 'failed', RESULT, { errorMessage: 'boom' })

    const where = dbChainMockFns.where.mock.calls[0][0]
    expect(hasMockCondition(where, (node: MockCondition) => node.type === 'exists')).toBe(false)
  })

  it('reports whether the close landed', async () => {
    const { completeSyncLog } = await import('@/lib/knowledge/connectors/sync-engine')

    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'log-1' }])
    await expect(
      completeSyncLog('log-1', 'completed', RESULT, { requireSyncLockOn: 'c-1' })
    ).resolves.toBe(true)

    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(
      completeSyncLog('log-1', 'completed', RESULT, { requireSyncLockOn: 'c-1' })
    ).resolves.toBe(false)
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
    vi.clearAllMocks()
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
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })

  it.each(['checkpoint', 'batch'] as const)(
    'releases the lock when a %s detects an archived connector',
    async (stage) => {
      const { executeSync } = await import('@/lib/knowledge/connectors/sync-engine')
      const { hardDeleteDocuments } = await import('@/lib/knowledge/documents/service')

      primeLockedRun()
      /** The initial checkpoint holds a live lease unless the archive already landed. */
      queueTableRows(schemaMock.knowledgeConnector, stage === 'checkpoint' ? [] : [{ id: 'c-1' }])
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.document, [])
      queueTableRows(schemaMock.knowledgeConnector, [
        stage === 'checkpoint'
          ? { archivedAt: new Date(), deletedAt: null }
          : { connectorArchivedAt: new Date(), connectorDeletedAt: null, kbDeletedAt: null },
      ])
      /** The leftover-document cleanup this path performs. */
      queueTableRows(schemaMock.document, [])
      vi.mocked(hardDeleteDocuments).mockResolvedValue(0)

      mockListDocuments.mockResolvedValue({
        documents: [
          {
            externalId: 'ext-1',
            title: 'ext-1',
            content: 'body',
            contentHash: 'h',
            mimeType: 'text/plain',
            metadata: {},
          },
        ],
        hasMore: false,
      })

      const result = await executeSync('c-1', {
        billingAttribution: { workspaceId: 'ws-1' } as never,
      })

      expect(result.skipReason).toBe('connector_deleted_during_sync')

      /**
       * This exit wrote nothing to the connector row, leaving it `syncing` with a
       * live token. The reaper requires `isNull(archivedAt)` and `isNull(deletedAt)`,
       * so the one writer that could clear a stranded lock skips exactly the rows
       * this path creates. Matches the two knowledge-base-deleted writers: release
       * token and lease, and make the transition terminal.
       */
      const release = dbChainMockFns.set.mock.calls.find(
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.lastSyncError ===
          'Connector deleted during sync'
      )
      expect(release?.[0]).toEqual(
        expect.objectContaining({
          status: 'error',
          nextSyncAt: null,
          syncLockToken: null,
          syncLockLeaseAt: null,
        })
      )

      /**
       * Guarded on ownership alone, never on {@link stillHoldsSyncLock}: the
       * connector being archived is this path's precondition, so a liveness clause
       * would reject every write the release exists to make.
       */
      const releaseOrder =
        dbChainMockFns.set.mock.invocationCallOrder[
          dbChainMockFns.set.mock.calls.indexOf(release as never)
        ]
      const releaseWhereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
        (order) => order > releaseOrder
      )
      const releaseWhere = dbChainMockFns.where.mock.calls[releaseWhereIndex][0]
      expect(
        hasMockCondition(
          releaseWhere,
          (node: MockCondition) =>
            node.type === 'eq' && node.left === schemaMock.knowledgeConnector.syncLockToken
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          releaseWhere,
          (node: MockCondition) =>
            node.type === 'isNull' && node.column === schemaMock.knowledgeConnector.archivedAt
        )
      ).toBe(false)

      /**
       * And this path's log close stays unguarded. Its connector is archived, so an
       * ownership-guarded close would match nothing and leave the row `started`
       * until the sync-log sweep mislabelled it.
       */
      expect(
        dbChainMockFns.where.mock.calls.some((call) =>
          hasMockCondition(call[0], (node: MockCondition) => node.type === 'exists')
        )
      ).toBe(false)
    }
  )
})
