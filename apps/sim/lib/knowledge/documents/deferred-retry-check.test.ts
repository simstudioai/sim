import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockInspect, mockSnapshotCondition } = vi.hoisted(() => ({
  mockInspect: vi.fn(),
  mockSnapshotCondition: vi.fn((snapshot: { id: string }) => ({
    type: 'snapshot',
    id: snapshot.id,
  })),
}))
vi.mock('@/lib/knowledge/documents/processing-recovery-queue', () => ({
  processingSnapshotColumns: {},
  documentProcessingSnapshotCondition: mockSnapshotCondition,
  inspectDocumentProcessingLiveness: mockInspect,
}))

import {
  checkDeferredDocumentRetry,
  DEFERRED_RETRY_CHECK_TERMINAL_MS,
  DEFERRED_RETRY_LOST_ERROR,
  DEFERRED_RETRY_RECHECK_MS,
} from '@/lib/knowledge/documents/deferred-retry-check'
import type { DeferredRetryCheckPayload } from '@/lib/knowledge/documents/processing-outbox-event'
import { QUEUED_DISPATCH_GRACE_MS, RECOVERY_WINDOW_MS } from '@/lib/knowledge/documents/types'

const QUEUED_AT = new Date('2026-09-01T00:00:00.000Z')
const DEFERRED_UNTIL = new Date('2026-09-01T00:02:00.000Z')
const OVERDUE = DEFERRED_UNTIL.getTime() + QUEUED_DISPATCH_GRACE_MS + 60_000

const PAYLOAD: DeferredRetryCheckPayload = {
  knowledgeBaseId: 'kb-1',
  documentId: 'doc-1',
  processingQueueToken: 'token-1',
  processingQueuedAt: QUEUED_AT.toISOString(),
  processingDeferredUntil: DEFERRED_UNTIL.toISOString(),
}

const DEFERRED_ROW = {
  id: 'doc-1',
  uploadedAt: new Date('2026-08-31T00:00:00.000Z'),
  processingStatus: 'pending',
  processingQueueToken: 'token-1',
  processingQueuedAt: QUEUED_AT,
  processingStartedAt: null,
  processingDeferredUntil: DEFERRED_UNTIL,
  processingCompletedAt: null,
  processingRecoveryAfter: null,
  connectorId: null,
  archivedAt: null,
  deletedAt: null,
}

const context = {
  eventId: 'event-1',
  eventType: 'knowledge.document.deferred-retry-check',
  attempts: 0,
  maxAttempts: 5,
  signal: new AbortController().signal,
  checkpointPayload: vi.fn(),
}

function failedWrite() {
  return dbChainMockFns.set.mock.calls.find(
    ([value]) => (value as Record<string, unknown>).processingStatus === 'failed'
  )?.[0]
}

async function check(row: Record<string, unknown> | null, now = OVERDUE) {
  vi.setSystemTime(now)
  queueTableRows(schemaMock.document, row ? [row] : [])
  return checkDeferredDocumentRetry(PAYLOAD, context)
}

describe('checkDeferredDocumentRetry', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers({ toFake: ['Date'] })
    mockInspect.mockImplementation(async (rows: unknown[]) => ({ abandoned: rows, live: [] }))
  })

  it('fails a document whose scheduled retry never ran, fenced on the snapshot it inspected', async () => {
    expect(await check(DEFERRED_ROW)).toBeUndefined()

    expect(mockInspect).toHaveBeenCalledWith([DEFERRED_ROW], context.signal)
    expect(failedWrite()).toEqual({
      processingStatus: 'failed',
      processingError: DEFERRED_RETRY_LOST_ERROR,
      processingDeferredUntil: null,
      processingCompletedAt: new Date(OVERDUE),
    })
    expect(failedWrite()).not.toHaveProperty('processingQueueToken')
    const where = dbChainMockFns.where.mock.calls.at(-1)?.[0]
    expect(mockSnapshotCondition).toHaveBeenCalledWith(DEFERRED_ROW)
    expect(hasMockCondition(where, (node) => node.type === 'snapshot')).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) =>
          node.type === 'eq' &&
          node.left === schemaMock.document.processingStatus &&
          node.right === 'pending'
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        where,
        (node) => node.type === 'isNull' && node.column === schemaMock.document.connectorId
      ) ||
        hasMockCondition(
          where,
          (node) => node.type === 'isNull' && node.left === schemaMock.document.connectorId
        )
    ).toBe(true)
  })

  it('checks again later without spending an attempt while the run may be live', async () => {
    mockInspect.mockResolvedValue({ abandoned: [], live: [DEFERRED_ROW] })

    expect(await check(DEFERRED_ROW)).toEqual({
      outcome: 'deferred',
      reason: 'Deferred retry may still be running',
      minimumBackoffMs: DEFERRED_RETRY_RECHECK_MS,
      consumeAttempt: false,
    })
    expect(failedWrite()).toBeUndefined()
  })

  it('stops rechecking past the recovery window, so the event always ends', async () => {
    mockInspect.mockResolvedValue({ abandoned: [], live: [DEFERRED_ROW] })

    expect(await check(DEFERRED_ROW, DEFERRED_UNTIL.getTime() + RECOVERY_WINDOW_MS)).toBeUndefined()
    expect(mockInspect).not.toHaveBeenCalled()
    expect(failedWrite()).toMatchObject({ processingStatus: 'failed' })
  })

  it.each([
    ['a replaced queue token', { processingQueueToken: 'token-2' }],
    ['a new dispatch generation', { processingQueuedAt: new Date('2026-09-02T00:00:00.000Z') }],
    ['a later deferral', { processingDeferredUntil: new Date('2026-09-01T01:00:00.000Z') }],
    ['a claimed retry', { processingStatus: 'processing', processingDeferredUntil: null }],
    ['a claim that kept the deferral stamp', { processingStatus: 'processing' }],
    ['a completed pass', { processingStatus: 'completed', processingDeferredUntil: null }],
    ['a failed document', { processingStatus: 'failed', processingDeferredUntil: null }],
    ['a deleted document', { deletedAt: new Date() }],
    ['an archived document', { archivedAt: new Date() }],
    ['a connector document', { connectorId: 'connector-1' }],
  ])('completes as a no-op after %s', async (_label, change) => {
    expect(await check({ ...DEFERRED_ROW, ...change })).toBeUndefined()
    expect(mockInspect).not.toHaveBeenCalled()
    expect(failedWrite()).toBeUndefined()
  })

  describe('database failures while checking', () => {
    const lockTimeout = () =>
      Object.assign(new Error('Failed query: private SQL'), {
        query: 'private SQL',
        cause: Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        }),
      })

    function expectDatabaseDeferral(result: unknown) {
      expect(result).toMatchObject({ outcome: 'deferred', consumeAttempt: false })
      const backoff = (result as { minimumBackoffMs: number }).minimumBackoffMs
      expect(backoff).toBeGreaterThan(0)
      expect(backoff).toBeLessThanOrEqual(DEFERRED_RETRY_RECHECK_MS)
    }

    it('postpones the check without spending an attempt when the read fails', async () => {
      vi.setSystemTime(OVERDUE)
      dbChainMockFns.limit.mockRejectedValueOnce(lockTimeout())
      expectDatabaseDeferral(await checkDeferredDocumentRetry(PAYLOAD, context))
    })

    it('spends an attempt on an error that is not a transient database failure', async () => {
      vi.setSystemTime(OVERDUE)
      const constraint = Object.assign(new Error('duplicate key'), { code: '23505' })
      dbChainMockFns.limit.mockRejectedValueOnce(constraint)
      await expect(checkDeferredDocumentRetry(PAYLOAD, context)).rejects.toBe(constraint)
    })

    it('spends attempts on a database failure once past the terminal bound, so the event ends', async () => {
      vi.setSystemTime(DEFERRED_UNTIL.getTime() + DEFERRED_RETRY_CHECK_TERMINAL_MS)
      const error = lockTimeout()
      dbChainMockFns.limit.mockRejectedValueOnce(error)
      await expect(checkDeferredDocumentRetry(PAYLOAD, context)).rejects.toBe(error)
    })
  })
})
