/**
 * @vitest-environment node
 */

import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTimeoutAbortController, getExecutionDeadlineAt } from '@/lib/core/execution-limits'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import {
  buildTableAbortState,
  buildTableUsageLimitClear,
  createWorkflowGroupAttemptTimeoutController,
  createWorkflowGroupCarrierTimeoutController,
  terminalizeAbortedQueuedCarrierMarker,
} from '@/background/workflow-column-execution'

const { appendTableEventMock } = vi.hoisted(() => ({ appendTableEventMock: vi.fn() }))

vi.mock('@/lib/table/events', () => ({ appendTableEvent: appendTableEventMock }))

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

afterEach(() => {
  vi.useRealTimers()
})

const QUEUED_PAYLOAD = {
  tableId: 'table-1',
  tableName: 'Table',
  rowId: 'row-1',
  groupId: 'group-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  executionTimeoutMs: 10_000,
  billingAttribution: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user' as const, id: 'user-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  },
}

describe('table workflow carrier deadline', () => {
  it('preserves one absolute deadline when a later cascade group creates its controller', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T12:00:00.000Z'))
    const carrier = createWorkflowGroupCarrierTimeoutController(QUEUED_PAYLOAD)
    const carrierDeadline = getExecutionDeadlineAt(carrier.signal)?.getTime()

    vi.advanceTimersByTime(4_000)
    const laterGroup = createTimeoutAbortController(
      QUEUED_PAYLOAD.executionTimeoutMs,
      carrier.signal
    )

    expect(carrierDeadline).toBe(new Date('2026-08-03T12:00:10.000Z').getTime())
    expect(getExecutionDeadlineAt(laterGroup.signal)?.getTime()).toBe(carrierDeadline)
    laterGroup.cleanup()
    carrier.cleanup()
  })

  it('aborts one registered attempt without aborting its row carrier', () => {
    const carrier = new AbortController()
    const attempt = createWorkflowGroupAttemptTimeoutController(QUEUED_PAYLOAD, carrier.signal)

    expect(abortManualExecution(QUEUED_PAYLOAD.executionId)).toBe(true)
    expect(attempt.signal.aborted).toBe(true)
    expect(carrier.signal.aborted).toBe(false)

    attempt.cleanup()
    expect(abortManualExecution(QUEUED_PAYLOAD.executionId)).toBe(false)
  })
})

describe('table workflow rate-limit pacing terminal state', () => {
  it('turns an expired attempt into a terminal timeout error', () => {
    expect(
      buildTableAbortState({
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timedOut: true,
        timeoutMs: 5_000,
      })
    ).toEqual({
      status: 'error',
      executionId: 'execution-1',
      jobId: null,
      workflowId: 'workflow-1',
      error: 'Execution timed out after 5 seconds',
      runningBlockIds: [],
    })
  })

  it('turns an uncorrelated backend cancellation into a terminal error', () => {
    expect(
      buildTableAbortState({
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timedOut: false,
      })
    ).toEqual({
      status: 'error',
      executionId: 'execution-1',
      jobId: null,
      workflowId: 'workflow-1',
      error: 'Cancelled',
      runningBlockIds: [],
    })
  })
})

describe('table workflow carrier abort cleanup', () => {
  it('terminalizes an unclaimed dispatcher marker when the shared deadline expires', async () => {
    vi.useFakeTimers()
    dbChainMockFns.returning.mockResolvedValueOnce([{ rowId: 'row-1' }])
    const carrier = createWorkflowGroupCarrierTimeoutController(QUEUED_PAYLOAD)
    vi.advanceTimersByTime(QUEUED_PAYLOAD.executionTimeoutMs)

    await expect(
      terminalizeAbortedQueuedCarrierMarker(QUEUED_PAYLOAD, carrier.signal)
    ).resolves.toBe(true)

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        executionId: 'execution-1',
        error: 'Execution timed out after 10 seconds',
      })
    )
    expect(appendTableEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        executionId: 'execution-1',
        error: 'Execution timed out after 10 seconds',
      })
    )
    carrier.cleanup()
  })

  it('does not emit a stale terminal event when the pending-marker claim is lost', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    const cancellation = new AbortController()
    cancellation.abort(new DOMException('user', 'AbortError'))

    await expect(
      terminalizeAbortedQueuedCarrierMarker(QUEUED_PAYLOAD, cancellation.signal)
    ).resolves.toBe(false)

    expect(appendTableEventMock).not.toHaveBeenCalled()
  })
})

describe('table workflow usage-limit clear', () => {
  it('carries the execution guard that preserves a late cancellation tombstone', () => {
    expect(
      buildTableUsageLimitClear({
        tableId: 'table-1',
        rowId: 'row-1',
        workspaceId: 'workspace-1',
        groupId: 'group-1',
        executionId: 'execution-1',
      })
    ).toEqual({
      tableId: 'table-1',
      rowId: 'row-1',
      data: {},
      workspaceId: 'workspace-1',
      executionsPatch: { 'group-1': null },
      cancellationGuard: { groupId: 'group-1', executionId: 'execution-1' },
    })
  })
})
