/** @vitest-environment node */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import type { ExternalDocument, SyncResult } from '@/connectors/types'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  triggerAvailable: vi.fn(),
  dispatch: vi.fn<(documents: DocumentData[]) => Promise<{ accepted: number; failed: number }>>(),
}))

vi.mock('@/lib/knowledge/connectors/sync-persistence', () => ({
  addDocument: mocks.add,
  updateDocument: mocks.update,
  persistSkippedDocuments: vi.fn(),
  persistSkippedRetryHashes: vi.fn(),
}))
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: mocks.triggerAvailable,
  processDocumentsWithQueue: mocks.dispatch,
}))

import { SyncLockLostException, stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'
import {
  createSyncRunState,
  type DocOp,
  type ProcessDocOpsInput,
  processDocOps,
} from '@/lib/knowledge/connectors/sync-primitives'

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
  vi.clearAllMocks()
  resetDbChainMock()
  dbChainMockFns.limit.mockResolvedValue([
    { connectorArchivedAt: null, connectorDeletedAt: null, kbDeletedAt: null },
  ])
  mocks.triggerAvailable.mockReturnValue(true)
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

describe('processDocOps dispatch buffering', () => {
  it('hydrates 61 unknown-size documents serially and dispatches only metadata in batches of 25, 25, and 11', async () => {
    const input = inputFor(61)
    let active = 0
    let peak = 0
    input.hydration.getDocument = vi.fn(async (externalId: string) => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return sourceDocument(externalId)
    })
    await expect(processDocOps(input)).resolves.toBe(true)
    expect(peak).toBe(1)
    expect(input.hydration.beforeHydration).toHaveBeenCalledTimes(61)
    expect(dispatchedIds().map((batch) => batch.length)).toEqual([25, 25, 11])
    expect(dispatchedIds().flat()).toEqual(input.pendingOps.map((op) => op.extDoc.externalId))
    expect(input.state.result).toMatchObject({
      docsAdded: 61,
      docsFailed: 0,
      processingDispatch: { requested: 61, accepted: 61, failed: 0 },
    })
    for (const [documents] of mocks.dispatch.mock.calls) {
      expect(
        documents.every(
          (document: DocumentData) => !('content' in document) && !('sourceFile' in document)
        )
      ).toBe(true)
    }
  })

  it.each([
    { name: 'unknown sizes', count: 6, estimatedBytes: undefined, batchSizes: [1, 1, 1, 1, 1, 1] },
    { name: 'small known sizes', count: 11, estimatedBytes: 1024, batchSizes: [5, 5, 1] },
  ])(
    'keeps the inline fallback at each hydration microbatch for $name',
    async ({ count, estimatedBytes, batchSizes }) => {
      mocks.triggerAvailable.mockReturnValue(false)
      const input = inputFor(count, estimatedBytes)
      const completed: string[][] = []
      input.onBatchComplete = async (documents) => {
        completed.push(documents.map((document) => document.externalId))
        expect(dispatchedIds()).toEqual(completed)
      }
      await expect(processDocOps(input)).resolves.toBe(true)
      expect(dispatchedIds().map((batch) => batch.length)).toEqual(batchSizes)
      expect(input.state.result.processingDispatch).toEqual({
        requested: count,
        accepted: count,
        failed: 0,
      })
    }
  )

  it('flushes already persisted documents when the next microbatch reaches the deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const input = inputFor(10)
    input.deadlineAt = Date.now() + 1000
    let completed = 0
    input.onBatchComplete = async () => {
      if (++completed === 3) vi.setSystemTime(input.deadlineAt!)
    }
    await expect(processDocOps(input)).resolves.toBe(false)
    expect(mocks.add).toHaveBeenCalledTimes(3)
    expect(dispatchedIds()).toEqual([['source-1', 'source-2', 'source-3']])
    expect(input.state.result.processingDispatch).toEqual({ requested: 3, accepted: 3, failed: 0 })
    expect(input.state.failedExternalIds.size).toBe(0)
  })

  it('flushes prior durable documents and preserves a provider 429 instead of continuing hydration', async () => {
    const input = inputFor(10)
    const throttled = Object.assign(new Error('Provider rate limit'), { status: 429 })
    input.hydration.getDocument = vi.fn(async (externalId: string) => {
      if (externalId === 'source-4') throw throttled
      return sourceDocument(externalId)
    })
    await expect(processDocOps(input)).rejects.toBe(throttled)
    expect(input.hydration.getDocument).toHaveBeenCalledTimes(4)
    expect(dispatchedIds()).toEqual([['source-1', 'source-2', 'source-3']])
    expect(input.state.result.processingDispatch).toEqual({ requested: 3, accepted: 3, failed: 0 })
    expect(input.onBatchComplete).toHaveBeenCalledTimes(3)
  })

  it('counts an enqueue exception once and continues later batches without resending it', async () => {
    const input = inputFor(61)
    mocks.dispatch.mockRejectedValueOnce(new Error('Queue unavailable'))
    await expect(processDocOps(input)).resolves.toBe(true)
    expect(dispatchedIds().map((batch) => batch.length)).toEqual([25, 25, 11])
    expect(new Set(dispatchedIds().flat()).size).toBe(61)
    expect(input.state.result).toMatchObject({
      docsAdded: 61,
      docsFailed: 0,
      processingDispatch: { requested: 61, accepted: 36, failed: 25 },
    })
  })

  it('preserves partial dispatch outcomes and continues with the remaining documents', async () => {
    const input = inputFor(26)
    mocks.dispatch.mockResolvedValueOnce({ accepted: 20, failed: 5 })
    await expect(processDocOps(input)).resolves.toBe(true)
    expect(dispatchedIds().map((batch) => batch.length)).toEqual([25, 1])
    expect(input.state.result.processingDispatch).toEqual({
      requested: 26,
      accepted: 21,
      failed: 5,
    })
  })

  it('forwards the same lease to persistence and queue dispatch for added and updated documents', async () => {
    const input = inputFor(2)
    input.pendingOps[1] = {
      type: 'update',
      existingId: 'existing-document',
      extDoc: input.pendingOps[1]!.extDoc,
    }
    await processDocOps(input)
    expect(mocks.add.mock.calls[0]?.at(-1)).toBe(input.lease)
    expect(mocks.update.mock.calls[0]?.at(-1)).toBe(input.lease)
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      [
        storedDocument(sourceDocument('source-1')),
        storedDocument(sourceDocument('source-2'), 'existing-document'),
      ],
      'knowledge-base',
      {},
      expect.any(String),
      input.billingAttribution,
      { connectorId: 'connector', stillHeld: input.lease.stillHeld }
    )
    expect(input.state.result).toMatchObject({ docsAdded: 1, docsUpdated: 1 })
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
