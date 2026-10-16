/**
 * An in-process run is stopped by aborting it here, which needs no Redis. Failure mode: the
 * signal deadline passes before the Redis writes start, and the local runs are left going.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import { signalExecutionStops } from '@/lib/execution/removal-stop-records'

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
