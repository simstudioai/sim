/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  hasMockCondition,
  type MockCondition,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: vi.fn(),
}))
vi.mock('@/lib/uploads', () => ({ StorageService: {} }))
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

import { isStuckDocumentSweepEligible } from '@/lib/knowledge/connectors/sync-engine'
import {
  processDocumentsWithQueue,
  retryDocumentProcessing,
} from '@/lib/knowledge/documents/service'

const DOC_DATA = {
  filename: 'report.pdf',
  fileUrl: 'https://example.com/report.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
}

/**
 * Runs the requeue and returns the values it wrote. Dispatch runs after the
 * reset transaction and needs infrastructure this test does not stand up, so a
 * throw from it is expected and irrelevant to the reset itself.
 */
async function captureRequeueValues(): Promise<Record<string, unknown>> {
  await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

  const resetCall = dbChainMockFns.set.mock.calls.find(
    (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'pending'
  )
  expect(resetCall).toBeDefined()
  return resetCall?.[0] as Record<string, unknown>
}

describe('retryDocumentProcessing requeue stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('clears the previous attempt terminal state', async () => {
    const values = await captureRequeueValues()

    // The queue stamp itself is written by `markDocumentsQueued` on dispatch,
    // covered below — the reset's job is only to undo the prior attempt.
    expect(values.processingCompletedAt).toBeNull()
    expect(values.processingError).toBeNull()
  })

  it('leaves processingStartedAt null so the API reports no start time', async () => {
    const values = await captureRequeueValues()

    expect(values.processingStartedAt).toBeNull()
  })
})

describe('processDocumentsWithQueue dispatch stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ userId: 'user-1', workspaceId: null }])
  })

  /**
   * The dispatch itself needs Trigger.dev infrastructure this test does not
   * stand up; the stamp is written before it, so a later throw is irrelevant.
   */
  async function dispatch(): Promise<void> {
    await processDocumentsWithQueue(
      [{ documentId: 'doc-1', ...DOC_DATA }],
      'kb-1',
      {},
      'req-1',
      undefined
    ).catch(() => {})
  }

  it('stamps the queue time and clears any leftover start time', async () => {
    const before = Date.now()
    await dispatch()
    const after = Date.now()

    const stampCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt instanceof Date
    )
    expect(stampCall).toBeDefined()
    const values = stampCall?.[0] as Record<string, unknown>

    expect(values.processingQueuedAt).toBeInstanceOf(Date)
    const stamp = values.processingQueuedAt as Date
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before)
    expect(stamp.getTime()).toBeLessThanOrEqual(after)
    expect(values.processingStartedAt).toBeNull()
  })

  it('puts the dispatched document outside the reach of the next connector sync', async () => {
    await dispatch()

    const stampCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt !== undefined
    )
    const values = stampCall?.[0] as Record<string, unknown>
    const uploadedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sweptAt = new Date(Date.now() + 60 * 1000)

    /**
     * The invariant the retry used to protect with its own inline stamp: a
     * document dispatched moments ago must not be reclaimed by a sweep that
     * would otherwise age it from a month-old `uploadedAt`.
     */
    expect(
      isStuckDocumentSweepEligible(
        {
          processingStatus: 'pending',
          processingQueuedAt: values.processingQueuedAt as Date | null,
          processingStartedAt: values.processingStartedAt as Date | null,
          uploadedAt,
        },
        sweptAt
      )
    ).toBe(false)

    // Without the stamp the same document ages from `uploadedAt` and is taken.
    expect(
      isStuckDocumentSweepEligible(
        {
          processingStatus: 'pending',
          processingQueuedAt: null,
          processingStartedAt: null,
          uploadedAt,
        },
        sweptAt
      )
    ).toBe(true)
  })
})

describe('retryDocumentProcessing double-click guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('only requeues a document in a terminal state', async () => {
    dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])

    await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

    /**
     * Unguarded, a second click reset a document the first had already queued,
     * so both dispatches ran, both indexed, and both billed.
     */
    const guard = dbChainMockFns.where.mock.calls.find((call) =>
      hasMockCondition(
        call[0],
        (node: MockCondition) =>
          node.type === 'inArray' && node.column === schemaMock.document.processingStatus
      )
    )
    expect(guard).toBeDefined()
    expect(
      hasMockCondition(
        guard?.[0],
        (node: MockCondition) =>
          node.type === 'inArray' &&
          Array.isArray(node.values) &&
          node.values.join(',') === 'completed,failed'
      )
    ).toBe(true)
  })

  it('does not dispatch or drop embeddings when it claimed nothing', async () => {
    // The guarded reset matched no rows: another click already queued this doc.
    dbChainMockFns.returning.mockResolvedValue([])

    const result = await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined)

    expect(result).toMatchObject({ success: true, status: 'pending' })
    expect(result.message).toContain('already queued')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    // No dispatch means no queue stamp was written either.
    expect(
      dbChainMockFns.set.mock.calls.some(
        (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt !== undefined
      )
    ).toBe(false)
  })
})

describe('processing attempt budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ userId: 'user-1', workspaceId: null }])
  })

  it('spends one attempt per dispatch, in the same guarded write', async () => {
    await processDocumentsWithQueue(
      [{ documentId: 'doc-1', ...DOC_DATA }],
      'kb-1',
      {},
      'req-1',
      undefined
    ).catch(() => {})

    const stampCall = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt !== undefined
    )
    const values = stampCall?.[0] as Record<string, unknown>

    /**
     * Charged as a SQL increment rather than a read-then-write, and in the same
     * statement as the queue stamp, so two concurrent dispatches cannot both
     * read the same count and spend one attempt between them.
     */
    expect(values.processingAttempts).toBeDefined()
    expect(typeof values.processingAttempts).not.toBe('number')
    expect((values.processingAttempts as { toSQL: () => { sql: string } }).toSQL().sql).toContain(
      '+ 1'
    )
  })
})
