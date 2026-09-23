/**
 * @vitest-environment node
 */

import { db } from '@sim/db'
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: vi.fn() }))
const { mockUploadFile } = vi.hoisted(() => ({ mockUploadFile: vi.fn() }))
const bindings = vi.hoisted(() => new Map<string, { id: string; contentUpdatedAt: Date }>())
vi.mock('@/lib/uploads', () => ({ StorageService: { uploadFile: mockUploadFile } }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({
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
  enqueueKnowledgeStorageCleanup: vi.fn(async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'cleanup-guard' }])
    return ['cleanup-guard']
  }),
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    fixture: {
      mapTags: (metadata: Record<string, unknown>) => ({
        label: metadata.label,
        owner: metadata.owner,
      }),
    },
  },
}))

import { MAX_ACL_TOKENS } from '@/lib/knowledge/access/tokens'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import { type LeaseTransaction, SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
import {
  addDocument,
  persistDocumentAcls,
  persistSourceDocumentFailures,
  resolveTagMapping,
  revokeDocumentAcls,
} from '@/lib/knowledge/connectors/sync-persistence'

const CONNECTOR = 'connector-1'

/** Runs each page straight on the mocked client, counting the transactions a writer opens. */
const pages = vi.fn()
const direct: LeaseTransaction = (write) => {
  pages()
  return write(db)
}

/** A lease that holds for `held` pages and is lost from then on. */
function losingLease(held: number): LeaseTransaction {
  let opened = 0
  return (write) => {
    opened += 1
    if (opened > held) return Promise.reject(new SyncLockLostException(CONNECTOR))
    return write(db)
  }
}

/**
 * Queues one ACL group's writes: the evidence refresh reports the external ids it matched, the
 * same transaction then reads the documents whose ACL changes (only when some were not
 * refreshed), and each change page reports the rows it wrote.
 */
function queueGroup(refreshed: string[], changed = 0, unrefreshed = changed > 0) {
  dbChainMockFns.returning.mockResolvedValueOnce(refreshed.map((externalId) => ({ externalId })))
  if (!unrefreshed) return
  const rows = Array.from({ length: changed }, (_unused, index) => ({
    id: `doc-${index}`,
    chunkCount: 1,
  }))
  queueTableRows(schemaMock.document, rows)
  /** The change page locks its documents and rereads their chunk counts before writing. */
  if (changed > 0) queueTableRows(schemaMock.document, rows)
  if (changed > 0)
    dbChainMockFns.returning.mockResolvedValueOnce(
      Array.from({ length: changed }, (_unused, index) => ({ id: `doc-${index}` }))
    )
}

describe('persistDocumentAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The rule this function exists to enforce: an ACL change must not look like
   * a content change. `processingStatus: 'pending'` is the sole trigger of
   * re-embedding, so assigning content fields here would re-embed the whole
   * corpus every time somebody joined a group.
   */
  it('refreshes only access fields, so no document is re-embedded', async () => {
    queueGroup([], 1)

    await persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:alice@corp.com']]]))

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      acl: ['u:alice@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.objectContaining({
        strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
        values: [],
      }),
    })
  })

  /**
   * Assigning `acl` fires the projection trigger, which rewrites every chunk row whose copy
   * differs, so a document whose ACL did not change must only have its evidence refreshed.
   */
  it('refreshes the evidence of an unchanged ACL without assigning it', async () => {
    queueGroup(['file-1'])

    await expect(
      persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:alice@corp.com']]]))
    ).resolves.toEqual({ updated: 1, rejected: 0 })

    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      aclVerifiedAt: expect.objectContaining({
        strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
        values: [],
      }),
    })
  })

  it('reports how many documents received current permission evidence', async () => {
    queueGroup(['file-1', 'file-2'])

    await expect(
      persistDocumentAcls(
        CONNECTOR,
        new Map([
          ['file-1', ['u:alice@corp.com']],
          ['file-2', ['u:alice@corp.com']],
        ])
      )
    ).resolves.toEqual({ updated: 2, rejected: 0 })
  })

  /**
   * Files under one folder overwhelmingly share an ACL, so grouping is what
   * keeps a crawl of thousands to a handful of statements.
   */
  it('writes one refresh and one change statement per distinct ACL, not per document', async () => {
    queueGroup([], 2)
    queueGroup([], 1)

    await persistDocumentAcls(
      CONNECTOR,
      new Map([
        ['file-1', ['u:alice@corp.com']],
        ['file-2', ['u:alice@corp.com']],
        ['file-3', ['u:bob@corp.com']],
      ])
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(4)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      acl: ['u:alice@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.objectContaining({
        strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
        values: [],
      }),
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(4, {
      acl: ['u:bob@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.objectContaining({
        strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
        values: [],
      }),
    })
  })

  it('groups ACLs that differ only in order or duplication', async () => {
    queueGroup([], 2)

    await persistDocumentAcls(
      CONNECTOR,
      new Map([
        ['file-1', ['u:bob@corp.com', 'u:alice@corp.com']],
        ['file-2', ['u:alice@corp.com', 'u:bob@corp.com', 'u:alice@corp.com']],
      ])
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      acl: ['u:alice@corp.com', 'u:bob@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.objectContaining({
        strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
        values: [],
      }),
    })
  })

  describe('an ACL we cannot store', () => {
    it('rejects workspace escape tokens even inside a source restriction', async () => {
      queueGroup([], 1)
      const result = await persistDocumentAcls(
        CONNECTOR,
        new Map([['file-1', { acl: ['u:alice@corp.com'], requirements: [['ws']] }]])
      )
      expect(result).toEqual({ updated: 1, rejected: 1 })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        acl: [],
        aclRequirements: [],
        aclVerifiedAt: null,
      })
    })

    it('retains an empty restriction and separately persists different clauses', async () => {
      queueGroup([], 1)
      queueGroup([], 1)
      await persistDocumentAcls(
        CONNECTOR,
        new Map([
          ['file-1', { acl: ['u:alice@corp.com'], requirements: [[]] }],
          ['file-2', { acl: ['u:alice@corp.com'], requirements: [['g:confluence:site:team']] }],
        ])
      )
      expect(dbChainMockFns.set).toHaveBeenCalledTimes(4)
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
        acl: ['u:alice@corp.com'],
        aclRequirements: [['u:alice@corp.com'], []],
        aclVerifiedAt: expect.objectContaining({
          strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
          values: [],
        }),
      })
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(4, {
        acl: ['u:alice@corp.com'],
        aclRequirements: [['u:alice@corp.com'], ['g:confluence:site:team']],
        aclVerifiedAt: expect.objectContaining({
          strings: ["statement_timestamp() AT TIME ZONE 'UTC'"],
          values: [],
        }),
      })
    })

    it('hides a document whose ACL carries a malformed token', async () => {
      queueGroup([], 1)

      await expect(
        persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:NOT-FOLDED@corp.com']]]))
      ).resolves.toEqual({ updated: 1, rejected: 1 })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        acl: [],
        aclRequirements: [],
        aclVerifiedAt: null,
      })
    })

    it('hides a document whose ACL exceeds the ceiling', async () => {
      queueGroup([], 1)
      const huge = Array.from({ length: MAX_ACL_TOKENS + 1 }, (_u, i) => `u:p${i}@corp.com`)

      await expect(persistDocumentAcls(CONNECTOR, new Map([['file-1', huge]]))).resolves.toEqual({
        updated: 1,
        rejected: 1,
      })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({
        acl: [],
        aclRequirements: [],
        aclVerifiedAt: null,
      })
    })

    it('stores an ACL exactly at the ceiling', async () => {
      queueGroup(['file-1'])
      const atLimit = Array.from({ length: MAX_ACL_TOKENS }, (_u, i) => `u:p${i}@corp.com`)

      await expect(persistDocumentAcls(CONNECTOR, new Map([['file-1', atLimit]]))).resolves.toEqual(
        { updated: 1, rejected: 0 }
      )
    })

    it('still writes the documents whose ACLs are fine', async () => {
      queueGroup(['file-1'])
      queueGroup(['file-2'])

      await expect(
        persistDocumentAcls(
          CONNECTOR,
          new Map([
            ['file-1', ['u:MIXED@corp.com']],
            ['file-2', ['u:alice@corp.com']],
          ])
        )
      ).resolves.toEqual({ updated: 2, rejected: 1 })
    })
  })

  it('does nothing when there is nothing to write', async () => {
    await expect(persistDocumentAcls(CONNECTOR, new Map())).resolves.toEqual({
      updated: 0,
      rejected: 0,
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})

describe('persistDocumentAcls paging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const changedGroup = (count: number) =>
    new Map(
      Array.from({ length: count }, (_unused, index) => [`file-${index}`, ['u:bob@corp.com']])
    )
  /** The documents the window's read finds changed, each carrying `chunkCount` chunks. */
  const queueChanged = (count: number, chunkCount: number) =>
    queueTableRows(
      schemaMock.document,
      Array.from({ length: count }, (_unused, index) => ({ id: `doc-${index}`, chunkCount }))
    )
  const assignedPages = () =>
    dbChainMockFns.set.mock.calls
      .map(([values], index) => ({
        values,
        order: dbChainMockFns.set.mock.invocationCallOrder[index],
      }))
      .filter(({ values }) => 'acl' in values)
      .map(({ order }) => {
        const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
          (whereOrder) => whereOrder > order
        )
        const ids = flattenMockConditions(dbChainMockFns.where.mock.calls[whereIndex]?.[0]).find(
          (node) => node.type === 'inArray' && node.column === schemaMock.document.id
        )?.values as string[]
        return ids.length
      })

  /** One transaction per page: a lease lock held across pages outlasted the statement timeout. */
  it('writes every page in a transaction of its own, bounded by projection rows', async () => {
    queueChanged(60, 10)

    await persistDocumentAcls(CONNECTOR, changedGroup(60), direct)

    expect(assignedPages()).toEqual([25, 25, 10])
    expect(pages).toHaveBeenCalledTimes(dbChainMockFns.set.mock.calls.length)
  })

  it('packs small documents into one page and gives a document above the cap a page alone', async () => {
    queueTableRows(schemaMock.document, [
      { id: 'small-1', chunkCount: 1 },
      { id: 'huge', chunkCount: 1_000 },
      { id: 'small-2', chunkCount: 1 },
      { id: 'small-3', chunkCount: 0 },
    ])

    await persistDocumentAcls(CONNECTOR, changedGroup(4), direct)

    expect(assignedPages()).toEqual([1, 1, 2])
  })

  /** An unchanged crawl costs the refresh alone: no change read, no change transaction. */
  it('writes a window whose every ACL is unchanged in one transaction', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce(
      Array.from({ length: 500 }, (_unused, index) => ({ externalId: `file-${index}` }))
    )

    await expect(persistDocumentAcls(CONNECTOR, changedGroup(500), direct)).resolves.toEqual({
      updated: 500,
      rejected: 0,
    })

    expect(pages).toHaveBeenCalledOnce()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('writes nothing further once the lease is lost between pages', async () => {
    queueChanged(60, 10)

    await expect(
      persistDocumentAcls(CONNECTOR, changedGroup(60), losingLease(2))
    ).rejects.toBeInstanceOf(SyncLockLostException)

    /** The evidence refresh and the first change page landed; the rest never ran. */
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
  })

  it('bounds each page in a transaction of its own by default', async () => {
    queueChanged(30, 10)

    await persistDocumentAcls(CONNECTOR, changedGroup(30))

    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(dbChainMockFns.set.mock.calls.length)
    const bounds = dbChainMockFns.execute.mock.calls.filter((call: unknown[]) =>
      JSON.stringify(call).includes('lock_timeout')
    )
    expect(bounds).toHaveLength(dbChainMockFns.transaction.mock.calls.length)
  })
})

describe('revokeDocumentAcls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  const REVOKED = { acl: [], aclRequirements: [], aclVerifiedAt: null }
  const EVIDENCE_ONLY = { aclRequirements: [], aclVerifiedAt: null }
  const scope = (batch: string[]) => inArray(schemaMock.document.id, batch)

  /** The SQL text of a mock `sql` node, or undefined for an operator node. */
  const sqlText = (node: Record<string, unknown>) =>
    Array.isArray(node.strings) ? node.strings.join('?') : undefined
  const grants = (node: Record<string, unknown>) =>
    sqlText(node)?.startsWith('cardinality(') && sqlText(node)?.endsWith(') > 0')

  /** Every `set`, paired with the `where` of the same statement. */
  function statements() {
    return dbChainMockFns.set.mock.calls.map(([values], index) => {
      const order = dbChainMockFns.set.mock.invocationCallOrder[index]
      const whereIndex = dbChainMockFns.where.mock.invocationCallOrder.findIndex(
        (whereOrder) => whereOrder > order
      )
      return {
        values,
        conditions: flattenMockConditions(dbChainMockFns.where.mock.calls[whereIndex]?.[0]),
      }
    })
  }
  /** The documents the window's read finds still granting someone. */
  const queueGranting = (count: number, chunkCount = 1) =>
    queueTableRows(
      schemaMock.document,
      Array.from({ length: count }, (_unused, index) => ({ id: `doc-${index}`, chunkCount }))
    )

  /**
   * Assigning `acl` fires the projection fan-out whether or not the value changes, so a
   * document that already grants nobody must never be in an `acl` assignment.
   */
  it('assigns acl only to documents that still grant someone', async () => {
    queueGranting(1)
    await revokeDocumentAcls(direct, ['a', 'b'], scope)

    const writes = statements().filter(({ values }) => 'acl' in values)
    expect(writes).toHaveLength(1)
    expect(writes[0].values).toEqual(REVOKED)
    expect(writes[0].conditions.some(grants)).toBe(true)
  })

  it('assigns nothing when no document still grants someone', async () => {
    await revokeDocumentAcls(direct, ['a', 'b'], scope)

    expect(statements().filter(({ values }) => 'acl' in values)).toHaveLength(0)
    expect(pages).toHaveBeenCalledOnce()
  })

  it('clears leftover evidence on an already-empty ACL without assigning acl', async () => {
    queueGranting(1)
    await revokeDocumentAcls(direct, ['a', 'b'], scope)

    const clears = statements().filter(({ values }) => !('acl' in values))
    expect(clears).toHaveLength(1)
    expect(clears[0].values).toEqual(EVIDENCE_ONLY)
    expect(
      clears[0].conditions.some(
        (node) => node.type === 'not' && grants(node.condition as Record<string, unknown>)
      )
    ).toBe(true)
  })

  /** Each document in an `acl` assignment costs a rewrite of every one of its chunks' projection rows. */
  it('assigns acl in pages bounded by projection rows and clears evidence per window', async () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `doc-${index}`)
    queueGranting(60, 10)

    await revokeDocumentAcls(direct, ids, scope)

    const pageSizes = statements()
      .filter(({ values }) => 'acl' in values)
      .map(({ conditions }) => {
        const pageIds = conditions.filter((node) => node.type === 'inArray').at(-1)
        return (pageIds?.values as string[]).length
      })
    expect(pageSizes).toEqual([25, 25, 10])
    expect(statements().filter(({ values }) => !('acl' in values))).toHaveLength(1)
  })

  it('runs every write in a transaction of its own', async () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `doc-${index}`)
    queueGranting(60, 10)

    await revokeDocumentAcls(direct, ids, scope)

    expect(pages).toHaveBeenCalledTimes(dbChainMockFns.set.mock.calls.length)
    expect(pages).toHaveBeenCalledTimes(4)
  })

  it('stops writing at the first page whose lease is gone', async () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `doc-${index}`)
    queueGranting(60, 10)

    await expect(revokeDocumentAcls(losingLease(2), ids, scope)).rejects.toBeInstanceOf(
      SyncLockLostException
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
  })
})

describe('persistSourceDocumentFailures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })
  const input = {
    knowledgeBaseId: 'kb',
    connectorId: CONNECTOR,
    connectorType: 'fixture',
    sourceConfig: {},
    access: 'members' as const,
    lease: { stillHeld: () => ({ type: 'lease' }) as never },
    documents: [
      {
        externalId: 'broken',
        title: 'Broken',
        content: '',
        contentDeferred: true,
        contentHash: 'new-version',
        mimeType: 'text/plain',
      },
    ],
    failedExternalIds: new Set(['broken']),
  }
  function leaseHeld() {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: CONNECTOR }])
  }
  it('records new failed downloads as hidden placeholders with no downloadable file or successful hash', async () => {
    leaseHeld()
    await persistSourceDocumentFailures({ ...input, priorByExternalId: new Map() })
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        externalId: 'broken',
        processingStatus: 'failed',
        processingError: expect.stringContaining('Source content'),
        storageKey: null,
        fileUrl: '',
        contentHash: null,
        acl: [],
      }),
    ])
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('invalidates a retained version without deleting its bytes, embeddings, or tombstone', async () => {
    leaseHeld()
    await persistSourceDocumentFailures({
      ...input,
      priorByExternalId: new Map([['broken', { id: 'old' }]]),
    })
    const update = dbChainMockFns.set.mock.calls[0][0]
    expect(update).toMatchObject({
      processingStatus: 'failed',
      contentHash: null,
      processingQueueToken: null,
    })
    expect(update).not.toHaveProperty('storageKey')
    expect(update).not.toHaveProperty('deletedAt')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('keeps each failed source reason distinct and keeps permission failures eligible for hydration', async () => {
    leaseHeld()
    const permission = getConnectorFailureDiagnostic(
      Object.assign(new Error('private body'), { status: 403 })
    )!
    const unavailable = getConnectorFailureDiagnostic(
      Object.assign(new Error('private body'), { status: 503 })
    )!
    await persistSourceDocumentFailures({
      ...input,
      documents: [input.documents[0], { ...input.documents[0], externalId: 'temporary' }],
      failedExternalIds: new Set(['broken', 'temporary']),
      sourceFailures: new Map([
        ['broken', permission],
        ['temporary', unavailable],
      ]),
      priorByExternalId: new Map([['broken', { id: 'old' }]]),
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        processingError: permission.message,
        contentHash: null,
        processingStatus: 'failed',
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith([
      expect.objectContaining({
        externalId: 'temporary',
        processingError: unavailable.message,
        contentHash: null,
      }),
    ])
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('acl')
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('storageKey')
    expect(JSON.stringify(dbChainMockFns.set.mock.calls)).not.toContain('private body')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
  it('bounds a source title that would exceed the filename index row limit', async () => {
    leaseHeld()
    const title = 'x'.repeat(5000)
    await persistSourceDocumentFailures({
      ...input,
      documents: [{ ...input.documents[0], title }],
      priorByExternalId: new Map(),
    })
    const [rows] = dbChainMockFns.values.mock.calls[0] as [Array<{ filename: string }>]
    expect(rows[0].filename).toBe(`${'x'.repeat(509)}...`)
    expect(rows[0].filename.length).toBe(512)
  })
  it('refuses to commit a failure under a reclaimed lease', async () => {
    queueTableRows(schemaMock.knowledgeBase, [{ id: 'kb' }])
    await expect(
      persistSourceDocumentFailures({ ...input, priorByExternalId: new Map() })
    ).rejects.toThrow('reclaimed')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('organization source cache persistence', () => {
  const source = {
    externalId: 'source-1',
    title: 'Source',
    content: 'indexed text',
    mimeType: 'text/plain',
    contentHash: 'hash-1',
  }
  const owner = { workspaceId: null, organizationId: 'org-1', userId: 'creator' }
  const lease = { stillHeld: () => schemaMock.knowledgeConnector.id }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockUploadFile.mockImplementation(async ({ customKey }: { customKey: string }) => ({
      key: customKey,
      path: `/api/files/serve/${encodeURIComponent(customKey)}`,
    }))
    dbChainMockFns.limit.mockResolvedValue([{ id: 'org-kb' }])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'connector-1' }])
  })

  it('stores the canonical organization binding while the document remains hidden until access sync', async () => {
    await addDocument('org-kb', 'connector-1', 'gmail', source, owner, undefined, 'members', lease)
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        context: 'knowledge-base',
        metadata: { organizationId: 'org-1', userId: 'creator', originalName: 'Source.txt' },
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'org-kb',
        connectorId: 'connector-1',
        storageKey: expect.stringMatching(/^kb\//),
        acl: [],
        processingStatus: 'pending',
      })
    )
  })

  it('rejects ambiguous ownership before writing provider bytes', async () => {
    await expect(
      addDocument(
        'org-kb',
        'connector-1',
        'gmail',
        source,
        { ...owner, workspaceId: 'workspace-1' },
        undefined,
        'members',
        lease
      )
    ).rejects.toThrow('exactly one')
    expect(mockUploadFile).not.toHaveBeenCalled()
  })
})

describe('resolveTagMapping', () => {
  it('bounds a mapped tag value that would exceed its index row limit and keeps a short one intact', () => {
    const tags = resolveTagMapping(
      'fixture',
      { label: 'y'.repeat(5000), owner: 'Purchasing' },
      { tagSlotMapping: { label: 'tag1', owner: 'tag2' } }
    )
    expect(tags?.tag1).toBe(`${'y'.repeat(509)}...`)
    expect(tags?.tag2).toBe('Purchasing')
  })

  it('keeps a value exactly at the limit untouched', () => {
    const atLimit = 'z'.repeat(512)
    const tags = resolveTagMapping(
      'fixture',
      { label: atLimit },
      { tagSlotMapping: { label: 'tag1' } }
    )
    expect(tags?.tag1).toBe(atLimit)
  })

  it('cuts by code point so a bounded value never ends in half a surrogate pair', () => {
    const tags = resolveTagMapping(
      'fixture',
      { label: '\u{1F600}'.repeat(600) },
      { tagSlotMapping: { label: 'tag1' } }
    )
    expect(tags?.tag1).toBe(`${'\u{1F600}'.repeat(254)}...`)
    expect(tags?.tag1?.length).toBeLessThanOrEqual(512)
  })
})
