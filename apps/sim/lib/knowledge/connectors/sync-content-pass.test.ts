/** @vitest-environment node */
import {
  dbChainMockFns,
  inputValidationMock,
  queueTableRows,
  resetDbChainMock as resetDatabaseMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { runConnectorContentPass } from '@/lib/knowledge/connectors/sync-content-pass'
import { SOURCE_CONTENT_ERROR } from '@/lib/knowledge/connectors/sync-limits'
import { stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import type { ExternalDocument, SyncResult } from '@/connectors/types'

function resetDbChainMock() {
  resetDatabaseMock()
  dbChainMockFns.execute.mockImplementation(async () => [{ startedAt: new Date().toISOString() }])
}

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  deleteFile: vi.fn(),
  deleteMetadata: vi.fn(),
  enqueueCleanup: vi.fn(async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'cleanup-guard' }])
    return ['cleanup-guard']
  }),
  dispatch: vi.fn(),
  onPage: vi.fn(),
  hardDelete: vi.fn(async (_ids: string[]) => 0),
}))
const bindings = vi.hoisted(() => new Map<string, { id: string; contentUpdatedAt: Date }>())

vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: mocks.hardDelete,
  isTriggerAvailable: () => true,
  processDocumentsWithQueue: mocks.dispatch,
}))
vi.mock('@/lib/uploads', () => ({ StorageService: { uploadFile: mocks.upload } }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: mocks.deleteFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({
  deleteFileMetadata: mocks.deleteMetadata,
  getFileMetadataByKeys: vi.fn(async (keys: string[]) =>
    keys.flatMap((key) => bindings.get(key) ?? [])
  ),
  insertImmutableFileMetadata: vi.fn(async (options: { id: string; key: string }) => {
    const binding = { id: options.id, contentUpdatedAt: new Date(0) }
    bindings.set(options.key, binding)
    return binding
  }),
}))
vi.mock('@/lib/knowledge/documents/storage-cleanup', () => ({
  KNOWLEDGE_STORAGE_CLEANUP_EVENT: 'knowledge.document.storage.cleanup',
  enqueueKnowledgeStorageCleanup: mocks.enqueueCleanup,
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
}))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

interface StoredPage {
  id: string
  externalId: string
  contentHash: string | null
  storageKey: string | null
  fileUrl: string
  userExcluded: boolean
  sourceSeenAt: Date | null
}

const SOURCE_CONFIG = { domain: 'fixture.atlassian.net', spaceKey: 'ENG' }
const EXISTING: StoredPage = {
  id: 'document',
  externalId: 'page',
  contentHash: null,
  storageKey: null,
  fileUrl: '',
  userExcluded: false,
  sourceSeenAt: null,
}
const BILLING: BillingAttributionSnapshot = {
  actorUserId: 'owner',
  workspaceId: 'workspace',
  organizationId: null,
  billedAccountUserId: 'owner',
  billingEntity: { type: 'user', id: 'owner' },
  billingPeriod: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
  payerSubscription: null,
}

let sourceVersion = 3
let hydrationVersion: number | undefined
let sourceBody: unknown = { value: '' }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
  sourceVersion = 3
  hydrationVersion = undefined
  sourceBody = { value: '' }
  mocks.hardDelete.mockResolvedValue(0)
  mocks.upload.mockImplementation(async ({ customKey }: { customKey: string }) => ({
    key: customKey,
    path: `/api/files/serve/${encodeURIComponent(customKey)}`,
  }))
  mocks.dispatch.mockImplementation(async (documents: unknown[]) => ({
    accepted: documents.length,
    failed: 0,
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const page = {
        id: 'page',
        title: 'Page',
        status: 'current',
        version: { number: sourceVersion },
      }
      if (url.pathname.endsWith('/spaces/space/pages')) return Response.json({ results: [page] })
      if (url.pathname.endsWith('/pages/page')) {
        return Response.json({
          ...page,
          version: { number: hydrationVersion ?? sourceVersion },
          body: { [url.searchParams.get('body-format') ?? 'view']: sourceBody },
        })
      }
      throw new Error(`Unexpected provider request: ${url.pathname}`)
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('completed listing removal counts', () => {
  interface AbsentDocument {
    id: string
    seenAt: string
    deletedAt: Date | null
  }

  const absent = (id: string, deletedAt: Date | null = null): AbsentDocument => ({
    id,
    seenAt: '2026-09-07T12:00:00.000000',
    deletedAt,
  })

  async function reconcile(options: {
    soft?: AbsentDocument[]
    hard?: AbsentDocument[]
    fullSync?: boolean
    updated?: { id: string }[]
  }) {
    resetDbChainMock()
    const soft = options.soft ?? []
    const hard = options.hard ?? []
    const checkpoint = {
      ...beginListingCheckpoint({
        fingerprint: 'a'.repeat(64),
        generationId: 'completed-listing',
        startedAt: new Date('2026-09-08T11:00:00Z'),
        fullSync: options.fullSync,
      }),
      complete: true,
      listedCount: 8,
    }
    queueTableRows(schemaMock.document, [
      { ownedCount: 10, listedCount: 8, softCount: soft.length, hardCount: hard.length },
    ])
    queueTableRows(schemaMock.document, [])
    if (!options.fullSync) {
      queueTableRows(schemaMock.document, soft)
      if (soft.length) {
        queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector' }])
        dbChainMockFns.returning.mockResolvedValueOnce(
          options.updated ?? soft.map(({ id }) => ({ id }))
        )
        queueTableRows(schemaMock.document, [])
      }
    }
    queueTableRows(schemaMock.document, hard)
    if (hard.length) queueTableRows(schemaMock.document, [])
    const result: SyncResult = {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
    }
    const pass = await runConnectorContentPass({
      connectorId: 'connector',
      connector: {
        knowledgeBaseId: 'kb',
        connectorType: 'confluence',
        listingCheckpoint: checkpoint,
      },
      connectorConfig: confluenceConnector,
      sourceConfig: SOURCE_CONFIG,
      syncContext: {},
      kbOwner: { workspaceId: 'workspace', userId: 'owner' },
      billingAttribution: BILLING,
      result,
      lease: {
        stillHeld: () => stillHoldsSyncLock('connector', 'run'),
        beatIfDue: async () => undefined,
        beatLive: async () => undefined,
      },
      leaseKind: 'content',
      runId: 'run',
      fingerprint: 'a'.repeat(64),
      documentAccess: 'admin',
      getAccessToken: async () => 'token',
      hydration: { getDocument: vi.fn() },
      forceRehydrate: false,
      deadlineAt: Date.now() + 60_000,
    })
    expect(pass.complete).toBe(true)
    return result
  }

  it('reports newly hidden documents once, without recounting their later cleanup', async () => {
    const first = await reconcile({ soft: [absent('one'), absent('two')] })
    expect(first.docsDeleted).toBe(2)
    expect(mocks.hardDelete).not.toHaveBeenCalled()

    mocks.hardDelete.mockResolvedValue(2)
    const cleanup = await reconcile({
      hard: [absent('one', new Date(0)), absent('two', new Date(0))],
    })
    expect(cleanup.docsDeleted).toBe(0)
    expect(mocks.hardDelete).toHaveBeenCalledWith(['one', 'two'], 'run', 'connector', 'kb', {
      connectorId: 'connector',
      knowledgeBaseId: 'kb',
      syncLockToken: 'run',
      lease: 'content',
    })

    const resumed = await reconcile({})
    expect(resumed.docsDeleted).toBe(0)
  })

  it('counts only rows the guarded soft-delete update actually changed', async () => {
    const result = await reconcile({
      soft: [absent('one'), absent('two')],
      updated: [{ id: 'one' }],
    })
    expect(result.docsDeleted).toBe(1)
  })

  it('counts full-sync removals of live documents but not already hidden tombstones', async () => {
    mocks.hardDelete.mockImplementation(async (ids: string[]) => ids.length)
    const result = await reconcile({
      fullSync: true,
      hard: [absent('live'), absent('already-hidden', new Date(0))],
    })
    expect(result.docsDeleted).toBe(1)
    expect(mocks.hardDelete.mock.calls.map(([ids]) => ids)).toEqual([['live'], ['already-hidden']])
  })

  it('does not report a full-sync removal when the guarded delete removed no live rows', async () => {
    mocks.hardDelete.mockResolvedValue(0)
    const result = await reconcile({ fullSync: true, hard: [absent('detached')] })
    expect(result.docsDeleted).toBe(0)
  })
})

/** Real listing, hydration, persistence and checkpoint logic, with only external systems mocked. */
async function runPass(
  options: {
    existing?: StoredPage
    access?: ConnectorAccessMode
    readCurrent?: boolean
    forceRehydrate?: boolean
    checkpoint?: ListingCheckpoint
    databaseTime?: Date
    getDocument?: () => Promise<ExternalDocument | null>
  } = {}
) {
  vi.clearAllMocks()
  resetDbChainMock()
  vi.setSystemTime(new Date(Date.now() + 60_000))
  if (options.databaseTime) {
    dbChainMockFns.execute.mockResolvedValue([{ startedAt: options.databaseTime.toISOString() }])
  }
  for (let index = 0; index < 16; index++) {
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        id: 'connector',
        connectorArchivedAt: null,
        connectorDeletedAt: null,
        kbDeletedAt: null,
      },
    ])
  }
  queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb' }])
  queueTableRows(schemaMock.document, options.existing ? [options.existing] : [])
  if (options.readCurrent) {
    queueTableRows(schemaMock.document, [{ fileUrl: options.existing?.fileUrl ?? '' }])
    if (
      sourceBody &&
      typeof sourceBody === 'object' &&
      'value' in sourceBody &&
      typeof sourceBody.value === 'string' &&
      sourceBody.value.length > 0
    ) {
      queueTableRows(schemaMock.document, [{ fileUrl: options.existing?.fileUrl ?? '' }])
    }
  }
  queueTableRows(schemaMock.document, [
    { ownedCount: 1, listedCount: 1, softCount: 0, hardCount: 0 },
  ])
  for (let index = 0; index < 3; index++) queueTableRows(schemaMock.document, [])
  dbChainMockFns.returning.mockResolvedValue([{ id: 'document' }])

  const access = options.access ?? 'workspace'
  const syncContext = {
    cloudId: 'cloud',
    spaceId: 'space',
    ...(access === 'admin' ? { mirrorsSourceAcls: true } : {}),
    ...(access === 'members' ? { perMemberListing: true } : {}),
  }
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }
  const hydrate = vi.fn(
    options.getDocument ??
      (() => confluenceConnector.getDocument('token', SOURCE_CONFIG, 'page', syncContext))
  )
  const listDocuments = vi.fn(confluenceConnector.listDocuments)
  const pass = await runConnectorContentPass({
    connectorId: 'connector',
    connector: {
      knowledgeBaseId: 'kb',
      connectorType: 'confluence',
      listingCheckpoint: options.checkpoint,
    },
    connectorConfig: { ...confluenceConnector, listDocuments },
    sourceConfig: SOURCE_CONFIG,
    syncContext,
    kbOwner: { workspaceId: 'workspace', userId: 'owner' },
    billingAttribution: BILLING,
    result,
    lease: {
      stillHeld: () => stillHoldsSyncLock('connector', 'run'),
      beatIfDue: async () => undefined,
      beatLive: async () => undefined,
    },
    leaseKind: 'content',
    runId: 'run',
    fingerprint: 'a'.repeat(64),
    documentAccess: access,
    getAccessToken: async () => 'token',
    hydration: { getDocument: hydrate },
    forceRehydrate: options.forceRehydrate ?? false,
    deadlineAt: Date.now() + 60_000,
    onPage: mocks.onPage,
  })
  return { pass, result, hydrate, listDocuments }
}

function contentWrite(): Record<string, unknown> {
  const call = dbChainMockFns.set.mock.calls.find(([value]) => Object.hasOwn(value, 'contentHash'))
  expect(call).toBeDefined()
  return call![0]
}

describe('content pass checkpoint intent', () => {
  it('uses the database clock for a new generation despite a different worker clock', async () => {
    const databaseTime = new Date('2026-09-08T10:00:00Z')
    sourceBody = { value: '<p>Current content</p>' }
    const { pass } = await runPass({ databaseTime, access: 'admin' })
    expect(pass.checkpoint.startedAt).toBe(databaseTime.toISOString())
    expect(mocks.onPage).toHaveBeenCalledWith(expect.any(Array), databaseTime)
  })

  it('passes the durable generation start to ACL updates when resuming with a later worker clock', async () => {
    const checkpoint = beginListingCheckpoint({
      fingerprint: 'a'.repeat(64),
      generationId: 'previous-run',
      startedAt: new Date('2026-09-08T11:00:00Z'),
    })
    sourceBody = { value: '<p>Current content</p>' }
    await runPass({ checkpoint, access: 'admin' })
    expect(mocks.onPage).toHaveBeenCalledWith(expect.any(Array), new Date(checkpoint.startedAt))
  })

  it.each([
    { name: 'full', incrementalSince: undefined },
    { name: 'incremental', incrementalSince: new Date('2026-09-07T12:00:00Z') },
  ])(
    'restarts an ordinary $name checkpoint when Full resync is requested',
    async ({ incrementalSince }) => {
      const checkpoint = {
        ...beginListingCheckpoint({
          fingerprint: 'a'.repeat(64),
          generationId: 'previous-run',
          startedAt: new Date('2026-09-08T11:00:00Z'),
          incrementalSince,
        }),
        cursor: 'saved-cursor',
        listedCount: 1,
      }
      sourceBody = { value: '<p>The included page changed without a parent edit.</p>' }

      const { pass, result, hydrate, listDocuments } = await runPass({
        existing: {
          ...EXISTING,
          contentHash: 'confluence:view-callouts:page:3',
          storageKey: 'kb/old.txt',
          sourceSeenAt: new Date(checkpoint.startedAt),
        },
        checkpoint,
        readCurrent: true,
        forceRehydrate: true,
      })

      expect(listDocuments.mock.calls[0]?.[2]).toBeUndefined()
      expect(listDocuments.mock.calls[0]?.[4]).toBeUndefined()
      expect(pass.checkpoint).toMatchObject({
        generationId: 'run',
        forceRehydrate: true,
        incrementalSince: null,
        fullSync: false,
        listedCount: 1,
      })
      expect(new Date(pass.checkpoint.startedAt).getTime()).toBeGreaterThan(
        new Date(checkpoint.startedAt).getTime()
      )
      expect(hydrate).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ docsUpdated: 1, docsFailed: 0 })
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          file: Buffer.from('The included page changed without a parent edit.'),
        })
      )
    }
  )

  it.each([
    { name: 'ordinary automatic retry', savedRehydrate: false, requestedRehydrate: false },
    { name: 'Full resync automatic retry', savedRehydrate: true, requestedRehydrate: false },
    { name: 'Full resync task retry', savedRehydrate: true, requestedRehydrate: true },
  ])(
    'preserves the generation and cursor for an $name',
    async ({ savedRehydrate, requestedRehydrate }) => {
      const checkpoint = {
        ...beginListingCheckpoint({
          fingerprint: 'a'.repeat(64),
          generationId: 'previous-run',
          startedAt: new Date('2026-09-08T11:00:00Z'),
          forceRehydrate: savedRehydrate,
          fullSync: true,
        }),
        cursor: 'saved-cursor',
        listedCount: 1,
      }
      const { pass, hydrate, listDocuments } = await runPass({
        existing: {
          ...EXISTING,
          contentHash: 'confluence:view-callouts:page:3',
          storageKey: 'kb/old.txt',
          sourceSeenAt: new Date(checkpoint.startedAt),
        },
        checkpoint,
        forceRehydrate: requestedRehydrate,
      })

      expect(listDocuments.mock.calls[0]?.[2]).toBe('saved-cursor')
      expect(pass.checkpoint).toMatchObject({
        generationId: checkpoint.generationId,
        startedAt: checkpoint.startedAt,
        forceRehydrate: savedRehydrate,
        fullSync: true,
      })
      expect(hydrate).not.toHaveBeenCalled()
      expect(mocks.dispatch).not.toHaveBeenCalled()
    }
  )
})

describe('Confluence empty content through the shared content pass', () => {
  it.each(['admin', 'members'] as const)(
    'recovers a failed stub, reuses its verified empty version, and indexes an edited page for %s',
    async (access) => {
      const first = await runPass({ existing: EXISTING, readCurrent: true, access })
      expect(first.pass).toMatchObject({
        complete: true,
        holdNotice: null,
        checkpoint: { contentFailures: false },
      })
      expect(first.result).toMatchObject({ docsFailed: 0, docsSkipped: 1, docsUpdated: 0 })
      const skipped = contentWrite()
      expect(skipped).toMatchObject({
        storageKey: null,
        fileUrl: '',
        processingStatus: 'failed',
        processingError: 'Document contains no extractable text',
      })
      expect(mocks.upload).not.toHaveBeenCalled()
      expect(mocks.dispatch).not.toHaveBeenCalled()
      expect(mocks.onPage).toHaveBeenCalledOnce()
      const stored = { ...EXISTING, contentHash: skipped.contentHash as string }

      const second = await runPass({ existing: stored, access })
      expect(second.hydrate).not.toHaveBeenCalled()
      expect(second.result).toMatchObject({ docsUnchanged: 1, docsSkipped: 0, docsFailed: 0 })
      expect(second.pass).toMatchObject({
        complete: true,
        holdNotice: null,
        checkpoint: { contentFailures: false },
      })
      expect(mocks.onPage).toHaveBeenCalledOnce()
      expect(mocks.dispatch).not.toHaveBeenCalled()
      expect(dbChainMockFns.set.mock.calls.some(([value]) => 'contentHash' in value)).toBe(false)

      sourceVersion = 4
      sourceBody = { value: '<p>The page now has useful content.</p>' }
      const third = await runPass({ existing: stored, readCurrent: true, access })
      expect(third.hydrate).toHaveBeenCalledOnce()
      expect(third.result).toMatchObject({
        docsUpdated: 1,
        docsFailed: 0,
        processingDispatch: { requested: 1, accepted: 1, failed: 0 },
      })
      expect(contentWrite()).toMatchObject({
        storageKey: expect.stringMatching(/^kb\//),
        processingStatus: 'pending',
        processingError: null,
      })
      expect(mocks.upload).toHaveBeenCalledWith(
        expect.objectContaining({ file: Buffer.from('The page now has useful content.') })
      )
      expect(mocks.dispatch).toHaveBeenCalledOnce()
    }
  )

  it('refreshes empty rendered views and indexes recovered dependencies without a parent edit', async () => {
    const first = await runPass({ existing: EXISTING, readCurrent: true })
    expect(first.result).toMatchObject({ docsFailed: 0, docsSkipped: 1, docsUpdated: 0 })
    expect(first.pass).toMatchObject({
      complete: true,
      holdNotice: null,
      checkpoint: { contentFailures: false },
    })
    const stored = { ...EXISTING, contentHash: contentWrite().contentHash as string }

    const second = await runPass({ existing: stored, readCurrent: true })
    expect(second.hydrate).toHaveBeenCalledOnce()
    expect(second.result).toMatchObject({ docsFailed: 0, docsSkipped: 1, docsUpdated: 0 })
    expect(second.pass).toMatchObject({
      complete: true,
      holdNotice: null,
      checkpoint: { contentFailures: false },
    })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()

    sourceBody = { value: '<p>The included page now has useful content.</p>' }
    const third = await runPass({ existing: stored, readCurrent: true })
    expect(sourceVersion).toBe(3)
    expect(third.hydrate).toHaveBeenCalledOnce()
    expect(third.result).toMatchObject({
      docsUpdated: 1,
      docsFailed: 0,
      processingDispatch: { requested: 1, accepted: 1, failed: 0 },
    })
    expect(contentWrite()).toMatchObject({
      contentHash: stored.contentHash,
      storageKey: expect.stringMatching(/^kb\//),
      processingStatus: 'pending',
      processingError: null,
    })
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ file: Buffer.from('The included page now has useful content.') })
    )
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })

  it.each(['workspace', 'admin', 'members'] as const)(
    'removes prior indexed content on a verified empty update and preserves %s access ownership',
    async (access) => {
      const existing = {
        ...EXISTING,
        contentHash: 'previous-version',
        storageKey: 'kb/old.txt',
        fileUrl: '/api/files/serve/kb/old.txt?context=knowledge-base',
      }
      const { result, pass } = await runPass({ existing, readCurrent: true, access })
      expect(result).toMatchObject({ docsSkipped: 1, docsFailed: 0 })
      expect(pass.holdNotice).toBeNull()
      const written = contentWrite()
      expect(written).toMatchObject({
        fileUrl: '',
        storageKey: null,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingQueuedAt: null,
        processingQueueToken: null,
        processingDeferredUntil: null,
        processingAttempts: 0,
      })
      if (access === 'workspace') expect(written.acl).toEqual(['ws'])
      else {
        expect(written).not.toHaveProperty('acl')
        expect(written).not.toHaveProperty('aclRequirements')
        expect(written).not.toHaveProperty('aclVerifiedAt')
      }
      expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.embedding)
      expect(mocks.enqueueCleanup).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({
            id: 'document',
            fileUrl: '/api/files/serve/kb/old.txt?context=knowledge-base',
          }),
        ],
        'document'
      )
      expect(mocks.deleteFile).not.toHaveBeenCalled()
      expect(mocks.dispatch).not.toHaveBeenCalled()
    }
  )

  it('records a new empty page as an explicit skip instead of a source failure', async () => {
    const { result, pass } = await runPass()
    expect(result).toMatchObject({ docsSkipped: 1, docsFailed: 0 })
    expect(pass.checkpoint.contentFailures).toBe(false)
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        externalId: 'page',
        contentHash: 'confluence:view-callouts:page:3',
        storageKey: null,
        processingError: 'Document contains no extractable text',
      }),
    ])
  })

  it('explicitly rehydrates a skipped source whose version is unchanged', async () => {
    sourceBody = { value: '<p>Local content is rechecked</p>' }
    const { result, hydrate } = await runPass({
      existing: { ...EXISTING, contentHash: 'confluence:storage-local-body-v2:page:3' },
      access: 'admin',
      readCurrent: true,
      forceRehydrate: true,
    })
    expect(hydrate).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ docsUpdated: 1, docsFailed: 0 })
  })

  it('does not cache an empty hydration against a different listed version', async () => {
    sourceVersion = 4
    hydrationVersion = 3
    await runPass({ existing: EXISTING, readCurrent: true, access: 'admin' })
    const skipped = contentWrite()
    expect(skipped.contentHash).toBe('confluence:storage-local-body-v2:page:3')

    hydrationVersion = undefined
    sourceBody = { value: '<p>Current version content</p>' }
    const { result, hydrate } = await runPass({
      existing: { ...EXISTING, contentHash: skipped.contentHash as string },
      readCurrent: true,
      access: 'admin',
    })
    expect(hydrate).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ docsUpdated: 1, docsFailed: 0 })
  })

  it.each([
    { name: 'missing body', body: undefined },
    { name: 'malformed body', body: { value: 42 } },
    { name: 'null hydration', getDocument: async () => null },
    {
      name: 'unclassified empty hydration',
      getDocument: async (): Promise<ExternalDocument> => ({
        externalId: 'page',
        title: 'Page',
        content: '',
        mimeType: 'text/plain',
        contentHash: 'new-version',
      }),
    },
  ])('preserves prior content and failure evidence for $name', async ({ body, getDocument }) => {
    sourceBody = body
    const { result, pass } = await runPass({
      existing: { ...EXISTING, contentHash: 'previous-version', storageKey: 'kb/old.txt' },
      getDocument,
    })
    expect(result).toMatchObject({ docsFailed: 1, docsSkipped: 0 })
    expect(pass).toMatchObject({
      holdNotice: SOURCE_CONTENT_ERROR,
      checkpoint: { contentFailures: true },
    })
    const written = contentWrite()
    expect(written).toMatchObject({
      contentHash: null,
      processingStatus: 'failed',
      processingError: SOURCE_CONTENT_ERROR,
    })
    expect(written).not.toHaveProperty('storageKey')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(mocks.deleteFile).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
