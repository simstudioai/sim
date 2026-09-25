import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import type { ExternalDocument, SyncResult } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  triggerAvailable: vi.fn(),
  persistHashes: vi.fn(),
  sourceMetadata: vi.fn(
    (_connectorType: string, doc: Pick<ExternalDocument, 'sourceUrl' | 'metadata'>) => ({
      sourceUrl: doc.sourceUrl ?? null,
      sourceModifiedAt: null,
      date1: doc.metadata?.lastActivity,
    })
  ),
  dispatch: vi.fn<(documents: DocumentData[]) => Promise<{ accepted: number; failed: number }>>(),
}))

vi.mock('@/lib/knowledge/connectors/sync-persistence', () => ({
  addDocument: mocks.add,
  updateDocument: mocks.update,
  persistSkippedDocuments: vi.fn(),
  persistHashOnlyUpdates: mocks.persistHashes,
  resolveSourceMetadataFields: mocks.sourceMetadata,
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  processDocumentsWithQueue: mocks.dispatch,
}))
vi.mock('@/lib/core/config/trigger-availability', () => ({
  isTriggerAvailable: mocks.triggerAvailable,
}))

import { SyncLockLostException, stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'
import {
  classifyExternalDoc,
  createSyncRunState,
  type DocOp,
  loadPageCorpus,
  type ProcessDocOpsInput,
  processDocOps,
} from '@/lib/knowledge/connectors/sync-primitives'

describe('connector-owned hash comparison', () => {
  const listed: ExternalDocument = {
    externalId: 'thread',
    title: 'Thread',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    contentHash: 'version:2',
  }
  const existing = { id: 'document', contentHash: 'version:2:text:a', storageKey: 'stored' }
  const matcher = (candidate: string, stored: string) =>
    stored.startsWith(`${candidate}:`) ? ('current' as const) : ('stale' as const)

  it('treats a listing the connector matches to the stored hash as unchanged', () => {
    expect(classifyExternalDoc(listed, existing)).toEqual({
      type: 'update',
      existingId: 'document',
    })
    expect(classifyExternalDoc(listed, existing, false, matcher)).toEqual({ type: 'unchanged' })
    expect(
      classifyExternalDoc({ ...listed, contentHash: 'version:3' }, existing, false, matcher)
    ).toEqual({ type: 'update', existingId: 'document' })
  })

  it('still rehydrates missing content and forced refreshes', () => {
    expect(classifyExternalDoc(listed, { ...existing, contentHash: null }, false, matcher)).toEqual(
      { type: 'update', existingId: 'document' }
    )
    expect(classifyExternalDoc(listed, existing, true, matcher)).toEqual({
      type: 'update',
      existingId: 'document',
    })
  })
})

describe('source-change skip retry policy', () => {
  const listed: ExternalDocument = {
    externalId: 'page',
    title: 'Page',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    contentHash: 'source:page:3',
    skippedRetryPolicy: 'source-change',
  }
  const existing = { id: 'document', contentHash: listed.contentHash, storageKey: null }

  it('reuses a verified skip until the source changes', () => {
    expect(classifyExternalDoc(listed, existing)).toEqual({ type: 'unchanged' })
    expect(classifyExternalDoc({ ...listed, contentHash: 'source:page:4' }, existing)).toEqual({
      type: 'update',
      existingId: 'document',
    })
  })

  it('still retries source failures and explicit rehydration', () => {
    expect(classifyExternalDoc(listed, { ...existing, contentHash: null })).toEqual({
      type: 'update',
      existingId: 'document',
    })
    expect(classifyExternalDoc(listed, existing, true)).toEqual({
      type: 'update',
      existingId: 'document',
    })
  })
})

function sourceDocument(externalId: string): ExternalDocument {
  return {
    externalId,
    title: `${externalId}.txt`,
    content: `Content of ${externalId}`,
    mimeType: 'text/plain',
    contentHash: `hash:${externalId}`,
  }
}

function storedDocument(source: ExternalDocument, documentId = source.externalId): DocumentData {
  return {
    documentId,
    filename: source.title,
    fileUrl: `https://storage.fixture.test/${documentId}`,
    fileSize: Buffer.byteLength(source.content),
    mimeType: source.mimeType,
  }
}

function inputFor(count: number, estimatedBytes?: number): ProcessDocOpsInput {
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }
  return {
    connectorId: 'connector',
    connector: { knowledgeBaseId: 'knowledge-base', connectorType: 'confluence' },
    sourceConfig: { domain: 'fixture.atlassian.net', spaceKey: 'ENG' },
    kbOwner: { workspaceId: 'workspace', userId: 'owner' },
    billingAttribution: {
      actorUserId: 'owner',
      workspaceId: 'workspace',
      organizationId: null,
      billedAccountUserId: 'owner',
      billingEntity: { type: 'user', id: 'owner' },
      billingPeriod: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
      payerSubscription: null,
    },
    pendingOps: Array.from(
      { length: count },
      (_, index): DocOp => ({
        type: 'add',
        extDoc: {
          ...sourceDocument(`source-${index + 1}`),
          content: '',
          contentDeferred: true,
          ...(estimatedBytes === undefined ? {} : { estimatedBytes }),
        },
      })
    ),
    corpus: { priorByExternalId: new Map() },
    forceRehydrate: false,
    state: createSyncRunState(result),
    hydration: {
      beforeHydration: vi.fn(async () => undefined),
      getDocument: vi.fn(async (externalId: string) => sourceDocument(externalId)),
    },
    lease: {
      beatIfDue: vi.fn(async () => undefined),
      beatLive: vi.fn(async () => undefined),
      stillHeld: () => stillHoldsSyncLock('connector', 'lease-token'),
    },
    documentAccess: 'admin',
    onBatchComplete: vi.fn(async () => undefined),
  }
}

function dispatchedIds(): string[][] {
  return mocks.dispatch.mock.calls.map(([documents]: [DocumentData[]]) =>
    documents.map((document) => document.documentId)
  )
}

beforeEach(() => {
  resetDbChainMock()
  dbChainMockFns.limit.mockResolvedValue([
    { connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
  ])
  mocks.triggerAvailable.mockReturnValue(true)
  mocks.persistHashes.mockResolvedValue([])
  mocks.add.mockImplementation(
    async (
      _knowledgeBaseId: string,
      _connectorId: string,
      _type: string,
      source: ExternalDocument
    ) => storedDocument(source)
  )
  mocks.update.mockImplementation(
    async (
      id: string,
      _knowledgeBaseId: string,
      _connectorId: string,
      _type: string,
      source: ExternalDocument
    ) => storedDocument(source, id)
  )
  mocks.dispatch.mockImplementation(async (documents: DocumentData[]) => ({
    accepted: documents.length,
    failed: 0,
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('processDocOps unchanged content under a new hash', () => {
  function refreshOf(storedHash: string, hydratedHash: string) {
    const input = inputFor(0)
    input.pendingOps = [
      {
        type: 'update',
        existingId: 'document',
        extDoc: { ...sourceDocument('thread'), content: '', contentDeferred: true },
      },
    ]
    input.corpus = {
      priorByExternalId: new Map([
        [
          'thread',
          {
            id: 'document',
            externalId: 'thread',
            contentHash: storedHash,
            storageKey: 'stored',
            userExcluded: false,
            sourceSeenAt: null,
          },
        ],
      ]),
    }
    input.hydration.getDocument = vi.fn(async () => ({
      ...sourceDocument('thread'),
      contentHash: hydratedHash,
      sourceUrl: 'https://source.fixture.test/thread',
      metadata: { lastActivity: '2026-09-08T12:00:00.000Z' },
    }))
    input.matchContentHash = (candidate, stored) =>
      candidate.split(':').at(-1) === stored.split(':').at(-1) ? 'equivalent' : 'stale'
    return input
  }

  it('advances the stored hash and source metadata when the connector finds the same text', async () => {
    const input = refreshOf('legacy:text-a', 'version:2:text-a')
    await expect(processDocOps(input)).resolves.toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(input.state.result.docsUnchanged).toBe(1)
    expect(mocks.persistHashes).toHaveBeenCalledWith(
      'knowledge-base',
      'connector',
      [
        {
          existingId: 'document',
          externalId: 'thread',
          contentHash: 'version:2:text-a',
          sourceMetadata: {
            sourceUrl: 'https://source.fixture.test/thread',
            sourceModifiedAt: null,
            date1: '2026-09-08T12:00:00.000Z',
          },
        },
      ],
      input.lease
    )
  })
})

describe('processDocOps dispatch buffering', () => {
  it('retains a safe per-source cause while successful siblings continue', async () => {
    const input = inputFor(2, 100)
    input.hydration.getDocument = vi.fn(async (externalId) => {
      if (externalId === 'source-1') {
        throw new Error('private wrapper', {
          cause: Object.assign(new Error('private response body'), { status: 403 }),
        })
      }
      return sourceDocument(externalId)
    })
    await expect(processDocOps(input)).resolves.toBe(true)
    expect(input.state.sourceFailures.get('source-1')).toMatchObject({
      category: 'authorization',
      status: 403,
    })
    expect(JSON.stringify([...input.state.sourceFailures.values()])).not.toContain('private')
    expect([...input.state.failedExternalIds]).toEqual(['source-1'])
    expect(input.state.result).toMatchObject({ docsAdded: 1, docsFailed: 1 })
    expect(dispatchedIds()).toEqual([['source-2']])
  })

  it('keeps the lease guard on a partial buffer flushed after the run loses ownership', async () => {
    const input = inputFor(10)
    const lost = new SyncLockLostException('connector')
    let batches = 0
    input.hydration.beforeHydration = async () => {
      if (++batches === 4) throw lost
    }
    mocks.dispatch.mockRejectedValueOnce(lost)
    await expect(processDocOps(input)).rejects.toBe(lost)
    expect(mocks.add).toHaveBeenCalledTimes(3)
    expect(dispatchedIds()).toEqual([['source-1', 'source-2', 'source-3']])
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.any(Array),
      'knowledge-base',
      {},
      expect.any(String),
      input.billingAttribution,
      'backfill',
      { connectorId: 'connector', stillHeld: input.lease.stillHeld }
    )
    expect(input.state.result.processingDispatch).toEqual({ requested: 3, accepted: 0, failed: 0 })
    expect(input.state.result.docsFailed).toBe(0)
  })

  it.each(['lease', 'persistence', 'dispatch'] as const)(
    'propagates lease loss from %s without converting it to an enqueue failure',
    async (failure) => {
      const input = inputFor(30)
      const lost = new SyncLockLostException('connector')
      if (failure === 'lease') vi.mocked(input.lease.beatLive).mockRejectedValueOnce(lost)
      if (failure === 'persistence') mocks.add.mockRejectedValueOnce(lost)
      if (failure === 'dispatch') mocks.dispatch.mockRejectedValueOnce(lost)
      await expect(processDocOps(input)).rejects.toBe(lost)
      expect(input.state.result.docsFailed).toBe(0)
      expect(input.state.result.processingDispatch.failed).toBe(0)
      expect(input.hydration.getDocument).toHaveBeenCalledTimes(failure === 'dispatch' ? 25 : 1)
      expect(mocks.dispatch).toHaveBeenCalledTimes(failure === 'dispatch' ? 1 : 0)
    }
  )
})

describe('loadPageCorpus read recovery', () => {
  it('retries only the failed bounded page and keeps earlier rows', async () => {
    vi.useFakeTimers()
    const row = (externalId: string) => ({
      id: externalId,
      externalId,
      contentHash: 'hash',
      storageKey: 'stored',
      userExcluded: false,
      sourceSeenAt: null,
    })
    dbChainMockFns.limit
      .mockResolvedValueOnce([row('source-1')])
      .mockRejectedValueOnce(
        new Error('query', {
          cause: Object.assign(new Error('connection'), { code: '08006' }),
        })
      )
      .mockResolvedValueOnce([row('source-501')])
    const result = loadPageCorpus(
      'connector',
      Array.from({ length: 501 }, (_, i) => `source-${i + 1}`)
    )
    await vi.runAllTimersAsync()
    const corpus = await result
    expect([...corpus.priorByExternalId.keys()]).toEqual(['source-1', 'source-501'])
    expect(dbChainMockFns.limit.mock.calls).toEqual([[501], [501], [501]])
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })
})
