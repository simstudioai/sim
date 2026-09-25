import {
  dbChainMockFns,
  flattenMockConditions,
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
import {
  SOURCE_CONTENT_ERROR,
  SOURCE_PERMISSION_ERROR,
} from '@/lib/knowledge/connectors/sync-limits'
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
  processDocumentsWithQueue: mocks.dispatch,
}))
vi.mock('@/lib/core/config/trigger-availability', () => ({ isTriggerAvailable: () => true }))
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
  resetDbChainMock()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
  sourceVersion = 3
  hydrationVersion = undefined
  sourceBody = { value: '' }
  mocks.hardDelete.mockResolvedValue(0)
  mocks.onPage.mockReset()
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
      if (url.pathname.endsWith('/pages/page/attachments')) return Response.json({ results: [] })
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

/**
 * Every statement that assigns `acl`, with its flattened WHERE. Selects call `where` too, so
 * each `set` is paired with the next `where` by call order.
 */
function _aclAssignments() {
  const whereOrder = dbChainMockFns.where.mock.invocationCallOrder
  return dbChainMockFns.set.mock.calls
    .map(([values], index) => {
      const setOrder = dbChainMockFns.set.mock.invocationCallOrder[index]
      const next = whereOrder.findIndex((order) => order > setOrder)
      return {
        values,
        conditions: flattenMockConditions(dbChainMockFns.where.mock.calls[next]?.[0]),
      }
    })
    .filter(({ values }) => 'acl' in values)
}

/** The guard that keeps an ACL already readable by nobody out of an `acl` assignment. */
function _grantsSomeone(node: Record<string, unknown>): boolean {
  return Array.isArray(node.strings) && node.strings.join('?') === 'cardinality(?) > 0'
}

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
    revoked?: AbsentDocument[]
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
    queueTableRows(schemaMock.document, options.revoked ?? [])
    if (options.revoked?.length) {
      /** Each window reads what still grants someone; pages are bounded by their chunks' rows. */
      const granting = options.revoked.map(({ id }) => ({ id, chunkCount: 10 }))
      queueTableRows(schemaMock.document, granting)
      /** Each revocation page plans from an unlocked read, then locks and rereads its chunks. */
      for (let offset = 0; offset < granting.length; offset += 25) {
        queueTableRows(schemaMock.document, granting.slice(offset, offset + 25))
        queueTableRows(schemaMock.document, granting.slice(offset, offset + 25))
      }
      /** Every revocation page is its own lease-proving transaction: one evidence clear, then acl pages. */
      const batches = 1 + Math.ceil(options.revoked.length / 25)
      for (let batch = 0; batch < batches; batch++)
        queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector' }])
      queueTableRows(schemaMock.document, [])
    }
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
})

/** Real listing, hydration, persistence and checkpoint logic, with only external systems mocked. */
async function runPass(
  options: {
    existing?: StoredPage
    access?: ConnectorAccessMode
    readCurrent?: boolean
    forceRehydrate?: boolean
    fullSync?: boolean
    checkpoint?: ListingCheckpoint
    databaseTime?: Date
    getDocument?: () => Promise<ExternalDocument | null>
    permissionsOnly?: boolean
    permissionStoredAfter?: StoredPage
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
  /** A permission-only page revokes a changed body first: its read of what still grants someone. */
  if (options.permissionsOnly && options.existing && options.existing.contentHash === 'old-body') {
    queueTableRows(schemaMock.document, [{ id: options.existing.id, chunkCount: 1 }])
    /** The revocation page plans from an unlocked read, then locks and rereads its chunks. */
    queueTableRows(schemaMock.document, [{ id: options.existing.id, chunkCount: 1 }])
    queueTableRows(schemaMock.document, [{ id: options.existing.id, chunkCount: 1 }])
  }
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
  if (options.permissionsOnly)
    queueTableRows(
      schemaMock.document,
      options.permissionStoredAfter ? [options.permissionStoredAfter] : []
    )
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
  const listDocuments = vi.fn(
    async (...args: Parameters<typeof confluenceConnector.listDocuments>) => {
      const page = await confluenceConnector.listDocuments(...args)
      return options.permissionsOnly
        ? { ...page, permissionsOnly: true, reconciliationSafe: false }
        : page
    }
  )
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
    fullSync: options.fullSync,
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
  it('does not reconcile deletions after a user listing failed, even without the unsafe marker', async () => {
    sourceBody = { value: '<p>Current content</p>' }
    const checkpoint = {
      ...beginListingCheckpoint({
        fingerprint: 'a'.repeat(64),
        generationId: 'prior',
        startedAt: new Date(0),
      }),
      listingFailures: {
        count: 1,
        samples: [
          {
            scope: 'unavailable@example.com',
            operation: 'gmail.threads.list',
            status: 400,
            reasons: ['failedPrecondition'],
          },
        ],
      },
    }
    const { pass, result } = await runPass({ checkpoint, access: 'admin' })
    expect(pass.complete).toBe(true)
    expect(pass.checkpoint.listingFailures).toEqual(checkpoint.listingFailures)
    expect(pass.holdNotice).toContain('unlisted documents were kept')
    expect(result.docsDeleted).toBe(0)
    expect(mocks.hardDelete).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls.some(([value]) => value.deletedAt != null)).toBe(false)
  })

  it('persists unresolved permissions independently of successful content processing', async () => {
    sourceBody = { value: '<p>Current content</p>' }
    mocks.onPage.mockResolvedValue({ permissionsIncomplete: true })
    const { pass, result } = await runPass({ access: 'admin' })
    expect(pass).toMatchObject({
      complete: true,
      holdNotice: SOURCE_PERMISSION_ERROR,
      checkpoint: { permissionFailures: true, contentFailures: false },
    })
    expect(result.docsFailed).toBe(0)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        listingCheckpoint: expect.objectContaining({ permissionFailures: true }),
      })
    )
  })

  it('does not erase an earlier worker permission failure when later pages verify successfully', async () => {
    const checkpoint = {
      ...beginListingCheckpoint({
        fingerprint: 'a'.repeat(64),
        generationId: 'prior',
        startedAt: new Date(0),
      }),
      permissionFailures: true,
    }
    mocks.onPage.mockResolvedValue({ permissionsIncomplete: false })
    const { pass } = await runPass({ checkpoint, access: 'admin' })
    expect(pass.holdNotice).toBe(SOURCE_PERMISSION_ERROR)
    expect(pass.checkpoint.permissionFailures).toBe(true)
  })

  it('uses the database clock for a new generation despite a different worker clock', async () => {
    const databaseTime = new Date('2026-09-08T10:00:00Z')
    sourceBody = { value: '<p>Current content</p>' }
    const { pass } = await runPass({ databaseTime, access: 'admin' })
    expect(pass.checkpoint.startedAt).toBe(databaseTime.toISOString())
    expect(mocks.onPage).toHaveBeenCalledWith(expect.any(Array), databaseTime)
  })
})

describe('permission refresh through the shared content pass', () => {
  const current: StoredPage = {
    ...EXISTING,
    contentHash: 'confluence:storage-local-body-v2:page:3',
    storageKey: 'kb/current.txt',
    sourceSeenAt: new Date('2026-09-07T12:00:00Z'),
  }

  it('never renews a changed body after its hydration fails', async () => {
    const { hydrate, result } = await runPass({
      access: 'admin',
      permissionsOnly: true,
      existing: { ...current, contentHash: 'old-body' },
      getDocument: async () => {
        throw new Error('provider unavailable')
      },
      permissionStoredAfter: { ...current, contentHash: null },
    })
    expect(hydrate).toHaveBeenCalledOnce()
    expect(result.docsFailed).toBe(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      acl: [],
      aclRequirements: [],
      aclVerifiedAt: null,
    })
    expect(dbChainMockFns.set.mock.calls.some(([value]) => 'sourceSeenAt' in value)).toBe(false)
    expect(mocks.onPage).toHaveBeenCalledWith([], expect.any(Date))
  })
})

describe('Confluence empty content through the shared content pass', () => {
  it('records a new empty page as an explicit skip instead of a source failure', async () => {
    const { result, pass } = await runPass()
    expect(result).toMatchObject({ docsSkipped: 1, docsFailed: 0 })
    expect(pass.checkpoint.contentFailures).toBe(false)
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        externalId: 'page',
        contentHash: 'confluence:view-text-v2:page:3',
        storageKey: null,
        processingError: 'Document contains no extractable text',
      }),
    ])
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
