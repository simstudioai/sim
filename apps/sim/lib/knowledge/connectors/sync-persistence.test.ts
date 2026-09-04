/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({ hardDeleteDocuments: vi.fn() }))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/lib/uploads/core/storage-service', () => ({ deleteFile: vi.fn() }))
vi.mock('@/lib/uploads/server/metadata', () => ({ deleteFileMetadata: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

import { MAX_ACL_TOKENS } from '@/lib/knowledge/access/tokens'
import { persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'

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
   * re-embedding, so assigning anything but `acl` here would re-embed the whole
   * corpus every time somebody joined a group.
   */
  it('assigns the ACL and nothing else, so no document is re-embedded', async () => {
    queueUpdatedCounts(1)

    await persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:alice@corp.com']]]))

    expect(dbChainMockFns.update).toHaveBeenCalledWith(schemaMock.document)
    expect(dbChainMockFns.set).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ acl: ['u:alice@corp.com'] })
  })

  it('reports how many documents actually changed', async () => {
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
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(1, { acl: ['u:alice@corp.com'] })
    expect(dbChainMockFns.set).toHaveBeenNthCalledWith(2, { acl: ['u:bob@corp.com'] })
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
    })
  })

  describe('an ACL we cannot store', () => {
    it('hides a document whose ACL carries a malformed token', async () => {
      queueUpdatedCounts(1)

      await expect(
        persistDocumentAcls(CONNECTOR, new Map([['file-1', ['u:NOT-FOLDED@corp.com']]]))
      ).resolves.toEqual({ updated: 1, rejected: 1 })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ acl: [] })
    })

    it('hides a document whose ACL exceeds the ceiling', async () => {
      queueUpdatedCounts(1)
      const huge = Array.from({ length: MAX_ACL_TOKENS + 1 }, (_u, i) => `u:p${i}@corp.com`)

      await expect(persistDocumentAcls(CONNECTOR, new Map([['file-1', huge]]))).resolves.toEqual({
        updated: 1,
        rejected: 1,
      })
      expect(dbChainMockFns.set).toHaveBeenCalledWith({ acl: [] })
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
