/**
 * Failure modes:
 * - the signal deadline passes before the Redis writes start, and the local runs are left going
 * - a ban stops a previously archived workspace whose ownership moved on, and its new owner's
 *   runs are stopped
 */
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { describe, expect, it, vi } from 'vitest'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import { recordExecutionStops, signalExecutionStops } from '@/lib/execution/removal-stop-records'

describe('signalling removed executions', () => {
  it('aborts the runs this process holds even after the signal deadline has passed', async () => {
    const abort = vi.fn()
    registerManualExecutionAborter('execution-local', abort)
    const deadline = new AbortController()
    deadline.abort()

    try {
      await expect(
        signalExecutionStops(
          [{ executionId: 'execution-local', executionDeadlineAt: null }],
          deadline.signal
        )
      ).resolves.toBe(1)
    } finally {
      unregisterManualExecutionAborter('execution-local', abort)
    }

    expect(abort).toHaveBeenCalledOnce()
  })
})

describe('recording a banned owner’s stops', () => {
  it('records nothing for a workspace the user no longer owns', async () => {
    resetDbChainMock()
    queueTableRows(workspace, [])

    await expect(
      db.transaction((tx) =>
        recordExecutionStops(tx, { workspaceIds: ['transferred'], ownerId: 'banned-user' })
      )
    ).resolves.toEqual([])

    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})
