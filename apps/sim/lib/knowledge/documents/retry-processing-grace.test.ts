import {
  dbChainMockFns,
  flattenMockConditions,
  type MockCondition,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/processing-outbox-event', () => ({
  enqueueKnowledgeDocumentProcessing: vi.fn(),
}))
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/connectors/registry.server', () => ({ CONNECTOR_REGISTRY: {} }))

import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { isStuckDocumentSweepEligible } from '@/lib/knowledge/connectors/sync-primitives'
import {
  processDocumentsWithQueue,
  retryDocumentProcessing,
} from '@/lib/knowledge/documents/service'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const OBSERVED_DOCUMENT = {
  uploadedAt: new Date(0),
  id: 'doc-1',
  processingStatus: 'completed',
  processingQueueToken: 'old-token',
  processingQueuedAt: new Date(0),
  processingStartedAt: null,
  processingDeferredUntil: null,
  processingCompletedAt: new Date(0),
  processingRecoveryAfter: null,
}

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
async function _captureRequeueValues(): Promise<Record<string, unknown>> {
  await retryDocumentProcessing('kb-1', 'doc-1', DOC_DATA, 'req-1', undefined).catch(() => {})

  const resetCall = dbChainMockFns.set.mock.calls.find(
    (call) => (call[0] as Record<string, unknown> | undefined)?.processingStatus === 'pending'
  )
  expect(resetCall).toBeDefined()
  return resetCall?.[0] as Record<string, unknown>
}

describe('processDocumentsWithQueue dispatch stamp', () => {
  beforeEach(() => {
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
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValueOnce([OBSERVED_DOCUMENT])
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
