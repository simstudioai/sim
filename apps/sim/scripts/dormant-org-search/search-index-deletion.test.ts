/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSearchIndexDocuments,
  evaluateDeletionGuard,
  type SearchIndexConnector,
  SearchIndexDeletionRefused,
  type SearchIndexDeletionStore,
  type SearchIndexKnowledgeBase,
} from '@/scripts/dormant-org-search/search-index-deletion'

const KB_ID = 'kb-search-index'

function connector(overrides: Partial<SearchIndexConnector> = {}): SearchIndexConnector {
  return {
    id: 'connector-1',
    status: 'paused',
    syncLockHeld: false,
    memberSyncLockHeld: false,
    deletedAt: null,
    detachedAt: null,
    ...overrides,
  }
}

const searchIndex: SearchIndexKnowledgeBase = { id: KB_ID, isSearchIndex: true, deletedAt: null }

/** An in-memory knowledge base: documents with chunk counts, plus the calls the run made. */
class FakeStore implements SearchIndexDeletionStore {
  knowledgeBase: SearchIndexKnowledgeBase | null = searchIndex
  connectors: SearchIndexConnector[] = [connector()]
  documents = new Map<string, { chunks: number; connector: boolean }>()
  pending = 0
  marks = 3
  mutations: string[] = []
  /** Chunks a late writer adds to a document the first time its page is deleted. */
  lateChunks = new Map<string, number>()
  guardReads = 0

  constructor(documents: number, chunksPerDocument = 3) {
    for (let index = 0; index < documents; index++) {
      this.documents.set(`doc-${String(index).padStart(4, '0')}`, {
        chunks: chunksPerDocument,
        connector: true,
      })
    }
  }

  async loadKnowledgeBase() {
    this.guardReads += 1
    return this.knowledgeBase
  }
  async listConnectors() {
    return this.connectors
  }
  async nextDocumentPage(_kb: string, afterId: string, limit: number) {
    return [...this.documents.entries()]
      .filter(([id, doc]) => doc.connector && id > afterId)
      .map(([id]) => id)
      .sort()
      .slice(0, limit)
  }
  async countChunks(ids: readonly string[]) {
    return ids.reduce((sum, id) => sum + (this.documents.get(id)?.chunks ?? 0), 0)
  }
  async deleteChunkBatch(_knowledgeBaseId: string, ids: readonly string[], limit: number) {
    this.mutations.push('deleteChunkBatch')
    let deleted = 0
    for (const id of ids) {
      const doc = this.documents.get(id)
      if (!doc) continue
      const take = Math.min(doc.chunks, limit - deleted)
      doc.chunks -= take
      deleted += take
      if (deleted === limit) break
    }
    return deleted
  }
  async deleteDocuments(_kb: string, ids: readonly string[], _requestId: string, _reset: boolean) {
    this.mutations.push('deleteDocuments')
    for (const id of ids) {
      const late = this.lateChunks.get(id)
      if (late) {
        this.lateChunks.delete(id)
        this.documents.get(id)!.chunks += late
      }
    }
    if (ids.some((id) => (this.documents.get(id)?.chunks ?? 0) > 0)) {
      return { kind: 'chunks-remain' } as const
    }
    let deleted = 0
    for (const id of ids) if (this.documents.delete(id)) deleted += 1
    return { kind: 'deleted', deleted, storageCleanupQueued: deleted } as const
  }
  async pendingStorageCleanup(cap: number) {
    return Math.min(this.pending, cap)
  }
  async projectionMarkCount() {
    return this.marks
  }
  async hasConnectorDocuments() {
    return [...this.documents.values()].some((doc) => doc.connector)
  }
  async hasStandaloneDocuments() {
    return [...this.documents.values()].some((doc) => !doc.connector)
  }
  async resetConnectorCursors() {
    this.mutations.push('resetConnectorCursors')
    return { connectors: this.connectors.length, members: 0 }
  }
}

const sleep = vi.fn(async () => undefined)

function run(store: FakeStore, options: Partial<Parameters<typeof deleteSearchIndexDocuments>[1]>) {
  return deleteSearchIndexDocuments(store, {
    knowledgeBaseId: KB_ID,
    execute: false,
    requestId: 'test-request',
    pauseMs: 0,
    sleep,
    ...options,
  })
}

describe('evaluateDeletionGuard', () => {
  it('accepts a search index whose connectors are all stopped', () => {
    expect(
      evaluateDeletionGuard(searchIndex, [
        connector(),
        connector({ id: 'connector-2', status: 'disabled' }),
      ])
    ).toEqual([])
  })

  it('refuses a missing base and a base that is not a search index', () => {
    expect(evaluateDeletionGuard(null, [])).toEqual(['knowledge base not found'])
    expect(evaluateDeletionGuard({ ...searchIndex, isSearchIndex: false }, [])).toEqual([
      expect.stringContaining('not an organization search index'),
    ])
  })

  it.each(['active', 'pending', 'syncing', 'error'])('refuses a %s connector', (status) => {
    expect(evaluateDeletionGuard(searchIndex, [connector({ status })])).toEqual([
      expect.stringContaining(`is ${status}`),
    ])
  })

  it('refuses a paused connector that still holds either sync lease', () => {
    expect(
      evaluateDeletionGuard(searchIndex, [
        connector({ syncLockHeld: true, memberSyncLockHeld: true }),
      ])
    ).toHaveLength(2)
  })

  it('refuses a detached connector and ignores a deleted one', () => {
    expect(
      evaluateDeletionGuard(searchIndex, [
        connector({ id: 'detached', status: 'active', detachedAt: new Date() }),
        connector({ id: 'deleted', status: 'active', deletedAt: new Date() }),
      ])
    ).toEqual([expect.stringContaining('connector detached is detached')])
  })
})

describe('deleteSearchIndexDocuments', () => {
  beforeEach(() => {
    sleep.mockClear()
  })

  it('refuses before reading any page when the guard fails', async () => {
    const store = new FakeStore(5)
    store.connectors = [connector({ status: 'active' })]
    const nextPage = vi.spyOn(store, 'nextDocumentPage')
    await expect(run(store, { execute: true })).rejects.toBeInstanceOf(SearchIndexDeletionRefused)
    expect(nextPage).not.toHaveBeenCalled()
    expect(store.mutations).toEqual([])
  })

  it('only reads in a dry run, walking at most three pages by default', async () => {
    const store = new FakeStore(10)
    const summary = await run(store, { pageSize: 2 })
    expect(store.mutations).toEqual([])
    expect(store.documents.size).toBe(10)
    expect(summary).toMatchObject({
      executed: false,
      pages: 3,
      documentsSeen: 6,
      chunksCounted: 18,
      afterId: 'doc-0005',
      done: false,
      connectorsReset: null,
    })
  })

  it('reports the end of a dry run without resetting connectors', async () => {
    const store = new FakeStore(3)
    const summary = await run(store, { pageSize: 2, maxPages: 10 })
    expect(summary.done).toBe(true)
    expect(summary.connectorsReset).toBeNull()
    expect(store.mutations).toEqual([])
  })

  it('deletes chunks in bounded batches before each page of documents, then resets connectors', async () => {
    const store = new FakeStore(5, 4)
    const summary = await run(store, { execute: true, pageSize: 2, chunkBatchSize: 3 })
    expect(store.documents.size).toBe(0)
    expect(summary).toMatchObject({
      executed: true,
      pages: 3,
      documentsDeleted: 5,
      chunksDeleted: 20,
      storageCleanupQueued: 5,
      afterId: 'doc-0004',
      done: true,
      connectorsReset: { connectors: 1, members: 0 },
      standaloneDocumentsRemain: false,
    })
    const pageMutations = store.mutations.slice(0, store.mutations.indexOf('deleteDocuments') + 1)
    expect(pageMutations).toEqual([
      'deleteChunkBatch',
      'deleteChunkBatch',
      'deleteChunkBatch',
      'deleteDocuments',
    ])
    expect(store.mutations.at(-1)).toBe('resetConnectorCursors')
  })

  it('stops at --max-pages and resumes from the reported cursor', async () => {
    const store = new FakeStore(5)
    const first = await run(store, { execute: true, pageSize: 2, maxPages: 1 })
    expect(first).toMatchObject({ pages: 1, documentsDeleted: 2, done: false, afterId: 'doc-0001' })
    expect(store.mutations).not.toContain('resetConnectorCursors')

    const second = await run(store, { execute: true, pageSize: 2, afterId: first.afterId })
    expect(second).toMatchObject({ documentsDeleted: 3, done: true })
    expect(store.documents.size).toBe(0)
  })

  it('does not reset connectors when documents before the resume cursor remain', async () => {
    const store = new FakeStore(4)
    const summary = await run(store, { execute: true, pageSize: 2, afterId: 'doc-0001' })
    expect(summary.done).toBe(true)
    expect(summary.connectorsReset).toBeNull()
    expect(store.documents.size).toBe(2)
  })

  it('never selects standalone uploads and reports that they remain', async () => {
    const store = new FakeStore(2)
    store.documents.set('doc-upload', { chunks: 2, connector: false })
    const summary = await run(store, { execute: true })
    expect(store.documents.has('doc-upload')).toBe(true)
    expect(summary.standaloneDocumentsRemain).toBe(true)
    expect(summary.connectorsReset).toEqual({ connectors: 1, members: 0 })
  })

  it('deletes chunks a late writer committed after the chunk pass', async () => {
    const store = new FakeStore(2)
    store.lateChunks.set('doc-0000', 2)
    const summary = await run(store, { execute: true })
    expect(summary.documentsDeleted).toBe(2)
    expect(summary.chunksDeleted).toBe(8)
  })

  it('re-reads the guard before every page and stops when a connector resumes', async () => {
    const store = new FakeStore(6)
    const deleteDocuments = store.deleteDocuments.bind(store)
    vi.spyOn(store, 'deleteDocuments').mockImplementation(async (...args) => {
      const outcome = await deleteDocuments(...args)
      store.connectors = [connector({ status: 'active' })]
      return outcome
    })
    await expect(run(store, { execute: true, pageSize: 2 })).rejects.toBeInstanceOf(
      SearchIndexDeletionRefused
    )
    expect(store.documents.size).toBe(4)
  })

  it('waits while the storage cleanup backlog is at its ceiling', async () => {
    const store = new FakeStore(1)
    store.pending = 50
    const pending = vi.spyOn(store, 'pendingStorageCleanup')
    let checks = 0
    pending.mockImplementation(async () => {
      checks += 1
      return checks <= 3 ? 50 : 0
    })
    await run(store, { execute: true, storageCleanupCeiling: 50, backpressureWaitMs: 1234 })
    expect(sleep).toHaveBeenCalledWith(1234)
    expect(store.documents.size).toBe(0)
  })

  it('retries a transient failure in place and fails on a permanent one', async () => {
    const store = new FakeStore(1)
    const deleteChunkBatch = store.deleteChunkBatch.bind(store)
    const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    })
    vi.spyOn(store, 'deleteChunkBatch')
      .mockRejectedValueOnce(lockTimeout)
      .mockImplementation(deleteChunkBatch)
    const summary = await run(store, { execute: true })
    expect(summary.documentsDeleted).toBe(1)

    const failing = new FakeStore(1)
    vi.spyOn(failing, 'deleteChunkBatch').mockRejectedValue(new Error('permission denied'))
    await expect(run(failing, { execute: true })).rejects.toThrow('permission denied')
    expect(failing.documents.size).toBe(1)
  })
})
