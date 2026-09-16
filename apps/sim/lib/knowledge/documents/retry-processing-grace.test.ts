/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  flattenMockConditions,
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

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { isStuckDocumentSweepEligible } from '@/lib/knowledge/connectors/sync-primitives'
import {
  processDocumentsWithQueue,
  retryDocumentProcessing,
} from '@/lib/knowledge/documents/service'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const DOC_DATA = {
  filename: 'report.pdf',
  fileUrl: 'https://example.com/report.pdf',
  fileSize: 1024,
  mimeType: 'application/pdf',
}

const BILLING_ATTRIBUTION: BillingAttributionSnapshot = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'workspace-owner',
  billingEntity: { type: 'user', id: 'workspace-owner' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
    source: 'default',
  },
  payerSubscription: null,
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
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'user-1', workspaceId: 'workspace-1', organizationId: null },
    ])
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
      BILLING_ATTRIBUTION
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

describe('retryDocumentProcessing requeue guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * Every node under `condition`, descending through BOTH `and` and `or`. The
   * shared `flattenMockConditions` stops at `or`, which is the node this guard
   * is built from — a predicate run through it silently reports `false`.
   */
  function flattenBranches(condition: unknown): MockCondition[] {
    if (!condition || typeof condition !== 'object') return []
    const node = condition as MockCondition
    if ((node.type === 'and' || node.type === 'or') && Array.isArray(node.conditions)) {
      return [node, ...node.conditions.flatMap(flattenBranches)]
    }
    return [node]
  }

  function hasBranch(condition: unknown, predicate: (node: MockCondition) => boolean): boolean {
    return flattenBranches(condition).some(predicate)
  }

  /** The `or(...)` node the requeue's WHERE narrows the eligible statuses with. */
  function statusGuard(): MockCondition {
    const call = dbChainMockFns.where.mock.calls.find((c) =>
      hasBranch(
        c[0],
        (node: MockCondition) =>
          node.type === 'inArray' && node.column === schemaMock.document.processingStatus
      )
    )
    expect(call).toBeDefined()
    const guard = flattenMockConditions(call?.[0]).find(
      (node: MockCondition) =>
        node.type === 'or' &&
        hasBranch(
          node,
          (branch) =>
            branch.type === 'inArray' && branch.column === schemaMock.document.processingStatus
        )
    )
    expect(guard).toBeDefined()
    return guard as MockCondition
  }

  it('requeues from a terminal state', async () => {
    dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])

    await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

    /**
     * Unguarded, a second click reset a document the first had already queued,
     * so both dispatches ran, both indexed, and both billed.
     */
    expect(
      hasBranch(
        statusGuard(),
        (node: MockCondition) =>
          node.type === 'inArray' &&
          node.column === schemaMock.document.processingStatus &&
          Array.isArray(node.values) &&
          node.values.join(',') === 'completed,failed'
      )
    ).toBe(true)
    const reset = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'pending'
    )
    expect(reset?.[0]).toMatchObject({
      processingQueuedAt: null,
      processingQueueToken: null,
    })
    expect(reset?.[0]).not.toHaveProperty('processingAttempts')
  })

  it('also requeues a pending document whose dispatch is certainly lost', async () => {
    dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])

    await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

    /**
     * A terminal-only guard strands a document that never left `pending`: a
     * worker killed before its claim UPDATE burns an attempt without changing
     * status, and past the attempt budget the connector sweep drops it too.
     */
    expect(
      hasBranch(
        statusGuard(),
        (node: MockCondition) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingStatus &&
          node.right === 'pending'
      )
    ).toBe(true)
  })

  it('ages the pending arm from the dispatch stamp on the shared grace', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-08-20T12:00:00.000Z')
    vi.setSystemTime(now)
    try {
      dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])
      await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

      const fragment = flattenBranches(statusGuard()).find(
        (node: MockCondition) => typeof node.toSQL === 'function'
      ) as unknown as { values: unknown[]; toSQL: () => { sql: string } }
      expect(fragment).toBeDefined()

      /**
       * Pinned whole: an inverted comparison, or one that drops the COALESCE,
       * admits a document dispatched seconds ago and bills a duplicate pass
       * alongside the run still waiting in the queue.
       */
      expect(fragment.toSQL().sql).toBe('COALESCE(?, ?) < ?')
      expect(fragment.values[0]).toBe(schemaMock.document.processingQueuedAt)
      // NULL means no dispatch ever stamped the row; `uploadedAt` is the same
      // fallback `isStuckDocumentSweepEligible` ages such a document from.
      expect(fragment.values[1]).toBe(schemaMock.document.uploadedAt)
      expect((fragment.values[2] as { value: Date }).value).toEqual(
        new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS)
      )
      expect(
        hasBranch(
          statusGuard(),
          (node: MockCondition) =>
            node.type === 'isNull' && node.column === schemaMock.document.processingDeferredUntil
        )
      ).toBe(true)
      expect(
        hasBranch(
          statusGuard(),
          (node: MockCondition) =>
            node.type === 'lt' &&
            node.left === schemaMock.document.processingDeferredUntil &&
            node.right instanceof Date &&
            node.right.getTime() === now.getTime() - QUEUED_DISPATCH_GRACE_MS
        )
      ).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits out the same grace the connector sweep waits out', async () => {
    /**
     * The two recovery paths must agree on when a queued dispatch is lost. A
     * retry that admitted `pending` sooner would re-dispatch a document the
     * sweep still considers live.
     */
    const uploadedAt = new Date('2026-08-20T00:00:00.000Z')
    const justInsideGrace = new Date(uploadedAt.getTime() + QUEUED_DISPATCH_GRACE_MS)
    const justOutsideGrace = new Date(justInsideGrace.getTime() + 1)
    const candidate = {
      processingStatus: 'pending' as const,
      processingQueuedAt: null,
      processingStartedAt: null,
      processingDeferredUntil: null,
      processingCompletedAt: null,
      uploadedAt,
    }

    expect(isStuckDocumentSweepEligible(candidate, justInsideGrace)).toBe(false)
    expect(isStuckDocumentSweepEligible(candidate, justOutsideGrace)).toBe(true)
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
        (call) =>
          (call[0] as Record<string, unknown> | undefined)?.processingQueuedAt instanceof Date
      )
    ).toBe(false)
  })
})

describe('processing attempt budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'user-1', workspaceId: 'workspace-1', organizationId: null },
    ])
  })

  it('spends one attempt per dispatch, in the same guarded write', async () => {
    await processDocumentsWithQueue(
      [{ documentId: 'doc-1', ...DOC_DATA }],
      'kb-1',
      {},
      'req-1',
      BILLING_ATTRIBUTION
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

describe('retryDocumentProcessing dispatch unwind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The reset commits in its own transaction, so a throwing dispatch leaves the
   * row `pending` with nothing queued behind it — and the grace window means the
   * same click cannot recover it for hours. Recording the failure returns it to
   * `failed`, which is immediately retryable.
   */
  it('records the failure on the row it reset when the dispatch throws', async () => {
    // The reset claims the document; the dispatch then fails for want of a
    // billing context, which this suite deliberately does not stand up.
    dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])

    const result = await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined)

    expect(result.success).toBe(false)
    const failedWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failedWrite).toBeDefined()
    expect((failedWrite?.[0] as Record<string, unknown>).processingError).toEqual(
      expect.any(String)
    )
  })

  it('does not report a dead document as a started retry', async () => {
    dbChainMockFns.returning.mockResolvedValue([{ id: 'doc-1' }])

    const result = await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined)

    // Reporting success here paints the UI green over a document that will
    // never be indexed.
    expect(result.message).not.toContain('retry processing started')
    expect(result.status).toBe('failed')
  })

  it('records and reports a returned zero-acceptance queue-admission result', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'doc-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValue([
      { userId: 'user-1', workspaceId: 'workspace-1', organizationId: null },
    ])

    const result = await retryDocumentProcessing(
      'kb-1',
      'doc-1',
      DOC_DATA,
      'req-1',
      BILLING_ATTRIBUTION
    )

    expect(result).toMatchObject({ success: false, status: 'failed' })
    expect(result.message).toContain('was not accepted')
    const failedWrite = dbChainMockFns.set.mock.calls.find(
      (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'failed'
    )
    expect(failedWrite).toBeDefined()
  })
})
