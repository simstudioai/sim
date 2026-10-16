/**
 * The outbox outcome of a removal stop decides whether a run keeps going: an outcome that
 * completes too early drops the stop, one that never completes dead-letters it. Failure modes:
 * - Redis refuses the cancellation write → retry, and the queue sweep still runs
 * - no Redis at all → the process-local flag is all there is, so the stop completes
 * - a queue sweep fails → retry
 * - one queue fails to load → the other is still swept, then retry
 * - a sweep stops at its cap having cancelled runs → continue without spending an attempt
 * - a sweep stops at its cap having cancelled nothing → retry, so it cannot loop forever
 */
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { EXECUTION_REMOVAL_STOP_EVENT } from '@/lib/execution/removal-stop-event'
import { executionRemovalStopOutboxHandlers } from '@/lib/execution/removal-stops'

const { mockJobQueue } = asyncJobsMockFns
const stopRemovedExecutions = executionRemovalStopOutboxHandlers[EXECUTION_REMOVAL_STOP_EVENT]

function context(): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: EXECUTION_REMOVAL_STOP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(),
  }
}

const payload = {
  workspaceId: 'workspace-1',
  executions: [{ executionId: 'execution-1', executionDeadlineAt: null }],
}

describe('execution removal stop outcome', () => {
  beforeEach(() => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    mockJobQueue.cancelByWorkspace.mockReset().mockResolvedValue({
      cancelledJobs: 0,
      complete: true,
    })
  })

  it('completes when there is no Redis to record the cancellation in', async () => {
    await expect(stopRemovedExecutions(payload, context())).resolves.toBeUndefined()
  })

  it('retries when Redis refuses the cancellation, after still sweeping the queue', async () => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue({
      eval: vi.fn().mockRejectedValue(new Error('READONLY')),
      publish: vi.fn().mockResolvedValue(1),
    })

    await expect(stopRemovedExecutions(payload, context())).rejects.toThrow('not recorded')
    expect(mockJobQueue.cancelByWorkspace).toHaveBeenCalledWith('workspace-1', expect.anything())
  })

  it('retries when the queue sweep fails', async () => {
    mockJobQueue.cancelByWorkspace.mockRejectedValue(new Error('provider unavailable'))

    await expect(stopRemovedExecutions(payload, context())).rejects.toThrow('provider unavailable')
  })

  it('still sweeps the database queue when the primary queue fails to load, then retries', async () => {
    asyncJobsMockFns.mockGetJobQueue.mockRejectedValueOnce(new Error('queue unavailable'))

    await expect(stopRemovedExecutions(payload, context())).rejects.toThrow('queue unavailable')
    expect(mockJobQueue.cancelByWorkspace).toHaveBeenCalledWith('workspace-1', expect.anything())
  })

  it('continues without spending an attempt when the sweep stops at its cap after progress', async () => {
    mockJobQueue.cancelByWorkspace.mockResolvedValue({ cancelledJobs: 1000, complete: false })

    await expect(stopRemovedExecutions(payload, context())).resolves.toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
    })
  })

  it('retries when the sweep stops without cancelling anything', async () => {
    mockJobQueue.cancelByWorkspace.mockResolvedValue({ cancelledJobs: 0, complete: false })

    await expect(stopRemovedExecutions(payload, context())).rejects.toThrow('no progress')
  })

  it('sweeps no queue for executions outside a removed workspace', async () => {
    await expect(
      stopRemovedExecutions({ executions: payload.executions }, context())
    ).resolves.toBeUndefined()
    expect(mockJobQueue.cancelByWorkspace).not.toHaveBeenCalled()
  })
})
