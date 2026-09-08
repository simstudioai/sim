/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
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
    queueTableRows(schemaMock.outboxEvent, [{ id: 'cleanup-guard' }])
    return ['cleanup-guard']
  }),
  isKnowledgeBaseOwnedStorageKey: (key: string) => key.startsWith('kb/'),
}))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

import { MAX_ACL_TOKENS } from '@/lib/knowledge/access/tokens'
import {
  addDocument,
  persistDocumentAcls,
  persistSourceDocumentFailures,
} from '@/lib/knowledge/connectors/sync-persistence'

const CONNECTOR = 'connector-1'

/** Each `update(...).where(...)` chain ends in `returning()`; one row per changed document. */
function queueUpdatedCounts(...counts: number[]) {
  for (const count of counts) {
    dbChainMockFns.returning.mockResolvedValueOnce(
      Array.from({ length: count }, (_unused, index) => ({ id: `doc-${index}` }))
    )
  }
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
    queueUpdatedCounts(1)

    await persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:alice@corp.com']]]))

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      acl: ['u:alice@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.any(Date),
    })
  })

  it('reports how many documents received current permission evidence', async () => {
    queueUpdatedCounts(2)

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
  it('writes one statement per distinct ACL, not per document', async () => {
    queueUpdatedCounts(2, 1)

    await persistDocumentAcls(
      CONNECTOR,
      new Map([
        ['file-1', ['u:alice@corp.com']],
        ['file-2', ['u:alice@corp.com']],
        ['file-3', ['u:bob@corp.com']],
      ])
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
      acl: ['u:alice@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.any(Date),
    })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
      acl: ['u:bob@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.any(Date),
    })
  })

  it('groups ACLs that differ only in order or duplication', async () => {
    queueUpdatedCounts(2)

    await persistDocumentAcls(
      CONNECTOR,
      new Map([
        ['file-1', ['u:bob@corp.com', 'u:alice@corp.com']],
        ['file-2', ['u:alice@corp.com', 'u:bob@corp.com', 'u:alice@corp.com']],
      ])
    )

    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      acl: ['u:alice@corp.com', 'u:bob@corp.com'],
      aclRequirements: [],
      aclVerifiedAt: expect.any(Date),
    })
  })

  describe('an ACL we cannot store', () => {
    it('rejects workspace escape tokens even inside a source restriction', async () => {
      queueUpdatedCounts(1)
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
      queueUpdatedCounts(1, 1)
      await persistDocumentAcls(
        CONNECTOR,
        new Map([
          ['file-1', { acl: ['u:alice@corp.com'], requirements: [[]] }],
          ['file-2', { acl: ['u:alice@corp.com'], requirements: [['g:confluence:site:team']] }],
        ])
      )
      expect(dbChainMockFns.set).toHaveBeenCalledTimes(2)
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, {
        acl: ['u:alice@corp.com'],
        aclRequirements: [['u:alice@corp.com'], []],
        aclVerifiedAt: expect.any(Date),
      })
      expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, {
        acl: ['u:alice@corp.com'],
        aclRequirements: [['u:alice@corp.com'], ['g:confluence:site:team']],
        aclVerifiedAt: expect.any(Date),
      })
    })

    it('hides a document whose ACL carries a malformed token', async () => {
      queueUpdatedCounts(1)

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
      queueUpdatedCounts(1)
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
      queueUpdatedCounts(1)
      const atLimit = Array.from({ length: MAX_ACL_TOKENS }, (_u, i) => `u:p${i}@corp.com`)

      await expect(persistDocumentAcls(CONNECTOR, new Map([['file-1', atLimit]]))).resolves.toEqual(
        { updated: 1, rejected: 0 }
      )
    })

    it('still writes the documents whose ACLs are fine', async () => {
      queueUpdatedCounts(1, 1)

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
