import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedisSet, mockPublish, mockSubscribe, mockRecordCancellationResult } = vi.hoisted(
  () => ({
    mockRedisSet: vi.fn(),
    mockPublish: vi.fn(),
    mockSubscribe: vi.fn(),
    mockRecordCancellationResult: vi.fn(),
  })
)

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({
    publish: mockPublish,
    subscribe: mockSubscribe,
    dispose: vi.fn(),
  }),
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordExecutionCancellationBackendResult: mockRecordCancellationResult,
}))

import {
  EXECUTION_CANCEL_MIN_RETENTION_MS,
  getCancellationChannel,
  markExecutionCancelled,
} from './cancellation'
import {
  abortManualExecution,
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from './manual-cancellation'

describe('markExecutionCancelled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns redis_unavailable when no Redis client exists', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
  })

  it('returns recorded when Redis write succeeds', async () => {
    mockRedisSet.mockResolvedValue('OK')
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: true,
      reason: 'recorded',
    })

    const expiryAt = mockRedisSet.mock.calls[0]?.[3]
    expect(mockRedisSet).toHaveBeenCalledWith(
      'execution:cancel:execution-1',
      '1',
      'PXAT',
      expect.any(Number)
    )
    expect(expiryAt).toBeGreaterThanOrEqual(Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS - 100)
  })

  it('uses the exact execution deadline when it is later than queue retention', async () => {
    const executionDeadlineAt = new Date(Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS * 2)
    mockRedisSet.mockResolvedValue('OK')
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await markExecutionCancelled('execution-deadline', { executionDeadlineAt })

    expect(mockRedisSet).toHaveBeenCalledWith(
      'execution:cancel:execution-deadline',
      '1',
      'PXAT',
      executionDeadlineAt.getTime()
    )
  })

  it('keeps the 14-day minimum when the execution deadline is sooner', async () => {
    const before = Date.now()
    const executionDeadlineAt = new Date(before + 60_000)
    mockRedisSet.mockResolvedValue('OK')
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await markExecutionCancelled('execution-short-deadline', { executionDeadlineAt })

    const expiryAt = mockRedisSet.mock.calls[0]?.[3]
    expect(expiryAt).toBeGreaterThanOrEqual(before + EXECUTION_CANCEL_MIN_RETENTION_MS)
  })

  it('returns redis_write_failed when Redis write throws', async () => {
    mockRedisSet.mockRejectedValue(new Error('set failed'))
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })
  })

  it('publishes even when the Redis write fails so local subscribers wake up', async () => {
    mockRedisSet.mockRejectedValue(new Error('set failed'))
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await markExecutionCancelled('execution-write-failed')

    expect(mockPublish).toHaveBeenCalledWith({ executionId: 'execution-write-failed' })
  })

  it('publishes a cancellation event after a successful Redis write', async () => {
    mockRedisSet.mockResolvedValue('OK')
    mockGetRedisClient.mockReturnValue({ set: mockRedisSet })

    await markExecutionCancelled('execution-2')

    expect(mockPublish).toHaveBeenCalledWith({ executionId: 'execution-2' })
    expect(mockRedisSet.mock.invocationCallOrder[0]).toBeLessThan(
      mockPublish.mock.invocationCallOrder[0]
    )
  })

  it('publishes even when Redis is unavailable so local subscribers wake up', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await markExecutionCancelled('execution-3')

    expect(mockPublish).toHaveBeenCalledWith({ executionId: 'execution-3' })
  })
})

describe('getCancellationChannel', () => {
  it('returns the same channel instance across calls', () => {
    expect(getCancellationChannel()).toBe(getCancellationChannel())
  })
})

describe('manual execution cancellation registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unregisterManualExecutionAborter('execution-1')
  })

  it('aborts registered executions', () => {
    const abort = vi.fn()

    registerManualExecutionAborter('execution-1', abort)

    expect(abortManualExecution('execution-1')).toBe(true)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'in_process',
      result: 'cancelled',
    })
  })

  it('returns false when no execution is registered', () => {
    expect(abortManualExecution('execution-missing')).toBe(false)
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'in_process',
      result: 'not_found',
    })
  })

  it('records an error when an in-process aborter throws', () => {
    registerManualExecutionAborter('execution-1', () => {
      throw new Error('abort failed')
    })

    expect(() => abortManualExecution('execution-1')).toThrow('abort failed')
    expect(mockRecordCancellationResult).toHaveBeenCalledWith({
      backend: 'in_process',
      result: 'error',
    })
  })

  it('unregisters executions', () => {
    const abort = vi.fn()

    registerManualExecutionAborter('execution-1', abort)
    unregisterManualExecutionAborter('execution-1')

    expect(abortManualExecution('execution-1')).toBe(false)
    expect(abort).not.toHaveBeenCalled()
  })

  it('does not let stale cleanup unregister a replacement aborter', () => {
    const staleAbort = vi.fn()
    const replacementAbort = vi.fn()

    registerManualExecutionAborter('execution-1', staleAbort)
    registerManualExecutionAborter('execution-1', replacementAbort)
    unregisterManualExecutionAborter('execution-1', staleAbort)

    expect(abortManualExecution('execution-1')).toBe(true)
    expect(staleAbort).not.toHaveBeenCalled()
    expect(replacementAbort).toHaveBeenCalledOnce()
  })
})
