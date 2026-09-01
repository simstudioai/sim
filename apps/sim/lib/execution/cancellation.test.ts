import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRedisEval,
  mockRedisExists,
  mockRedisPublish,
  mockSignalSubscribe,
  mockSignalUnsubscribe,
  mockPublishLocalSignal,
  mockRecordCancellationResult,
} = vi.hoisted(() => ({
  mockRedisEval: vi.fn(),
  mockRedisExists: vi.fn(),
  mockRedisPublish: vi.fn(),
  mockSignalSubscribe: vi.fn(),
  mockSignalUnsubscribe: vi.fn(),
  mockPublishLocalSignal: vi.fn(),
  mockRecordCancellationResult: vi.fn(),
}))

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

vi.mock('@/lib/execution/execution-signal', () => ({
  getExecutionSignalChannel: (executionId: string) => `execution:signal:${executionId}`,
  getExecutionSignalHub: () => ({ subscribe: mockSignalSubscribe }),
  LEGACY_EXECUTION_CANCEL_CHANNEL: 'execution:cancel',
  publishLocalExecutionSignal: mockPublishLocalSignal,
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordExecutionCancellationBackendResult: mockRecordCancellationResult,
}))

import {
  EXECUTION_CANCEL_MIN_RETENTION_MS,
  markExecutionCancelled,
  subscribeToExecutionCancellation,
} from './cancellation'
import {
  abortManualExecution,
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from './manual-cancellation'

describe('markExecutionCancelled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignalSubscribe.mockResolvedValue(mockSignalUnsubscribe)
    mockRedisExists.mockResolvedValue(0)
    mockRedisPublish.mockResolvedValue(1)
  })

  it('returns redis_unavailable when no Redis client exists', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
    expect(mockPublishLocalSignal).toHaveBeenCalledWith('execution-1', 'cancelled')
  })

  it('returns recorded when Redis write succeeds', async () => {
    mockRedisEval.mockResolvedValue(1)
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: true,
      reason: 'recorded',
    })

    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('PUBLISH'"),
      1,
      'execution:cancel:execution-1',
      expect.any(Number),
      'execution:signal:execution-1',
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1', executionSignalPublished: true })
    )
    const redisExpiryAt = mockRedisEval.mock.calls[0]?.[3]
    expect(redisExpiryAt).toBeGreaterThanOrEqual(
      Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS - 100
    )
  })

  it('uses the exact execution deadline when it is later than queue retention', async () => {
    const executionDeadlineAt = new Date(Date.now() + EXECUTION_CANCEL_MIN_RETENTION_MS * 2)
    mockRedisEval.mockResolvedValue(1)
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval })

    await markExecutionCancelled('execution-deadline', { executionDeadlineAt })

    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'execution:cancel:execution-deadline',
      executionDeadlineAt.getTime(),
      'execution:signal:execution-deadline',
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-deadline', executionSignalPublished: true })
    )
  })

  it('keeps the 14-day minimum when the execution deadline is sooner', async () => {
    const before = Date.now()
    const executionDeadlineAt = new Date(before + 60_000)
    mockRedisEval.mockResolvedValue(1)
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval })

    await markExecutionCancelled('execution-short-deadline', { executionDeadlineAt })

    const expiryAt = mockRedisEval.mock.calls[0]?.[3]
    expect(expiryAt).toBeGreaterThanOrEqual(before + EXECUTION_CANCEL_MIN_RETENTION_MS)
  })

  it('returns redis_write_failed when Redis write throws', async () => {
    mockRedisEval.mockRejectedValue(new Error('set failed'))
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval, publish: mockRedisPublish })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })
    await vi.waitFor(() => expect(mockRedisPublish).toHaveBeenCalledTimes(2))
    expect(mockRedisPublish).toHaveBeenNthCalledWith(1, 'execution:signal:execution-1', 'cancelled')
    expect(mockRedisPublish).toHaveBeenNthCalledWith(
      2,
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1', executionSignalPublished: true })
    )
  })

  it('uses the legacy signal when the exact best-effort signal also fails', async () => {
    mockRedisEval.mockRejectedValue(new Error('set failed'))
    mockRedisPublish
      .mockRejectedValueOnce(new Error('exact publish failed'))
      .mockResolvedValueOnce(1)
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval, publish: mockRedisPublish })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })
    await vi.waitFor(() => expect(mockRedisPublish).toHaveBeenCalledTimes(2))
    expect(mockRedisPublish).toHaveBeenNthCalledWith(
      2,
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1' })
    )
  })

  it('does not wait for best-effort notification after the Redis write fails', async () => {
    mockRedisEval.mockRejectedValue(new Error('set failed'))
    let resolveExactPublish!: (value: number) => void
    mockRedisPublish
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveExactPublish = resolve
        })
      )
      .mockResolvedValueOnce(1)
    mockGetRedisClient.mockReturnValue({ eval: mockRedisEval, publish: mockRedisPublish })

    await expect(markExecutionCancelled('execution-1')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_write_failed',
    })
    expect(mockRedisPublish).toHaveBeenCalledOnce()

    resolveExactPublish(1)
    await vi.waitFor(() => expect(mockRedisPublish).toHaveBeenCalledTimes(2))
  })

  it('publishes through the configured process-local provider when Redis is unavailable', async () => {
    mockGetRedisClient.mockReturnValue(null)

    await markExecutionCancelled('execution-3')

    expect(mockRedisEval).not.toHaveBeenCalled()
    expect(mockPublishLocalSignal).toHaveBeenCalledWith('execution-3', 'cancelled')
  })

  it('still reports Redis unavailable when the local signal provider rejects the notification', async () => {
    mockGetRedisClient.mockReturnValue(null)
    mockPublishLocalSignal.mockImplementationOnce(() => {
      throw new Error('local signal unavailable')
    })

    await expect(markExecutionCancelled('execution-local-signal-error')).resolves.toEqual({
      durablyRecorded: false,
      reason: 'redis_unavailable',
    })
  })

  it('expires process-local cancellation records after their retention window', async () => {
    vi.useFakeTimers()
    try {
      mockGetRedisClient.mockReturnValue(null)
      const onCancelled = vi.fn()

      await markExecutionCancelled('execution-expiring-local-record')
      await vi.advanceTimersByTimeAsync(EXECUTION_CANCEL_MIN_RETENTION_MS)
      await subscribeToExecutionCancellation('execution-expiring-local-record', onCancelled)

      expect(onCancelled).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('subscribeToExecutionCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignalSubscribe.mockResolvedValue(mockSignalUnsubscribe)
    mockRedisExists.mockResolvedValue(0)
    mockGetRedisClient.mockReturnValue({ exists: mockRedisExists })
  })

  it('subscribes before reading the durable cancellation flag', async () => {
    const order: string[] = []
    mockSignalSubscribe.mockImplementation(async () => {
      order.push('subscribe')
      return mockSignalUnsubscribe
    })
    mockRedisExists.mockImplementation(async () => {
      order.push('read')
      return 0
    })

    await subscribeToExecutionCancellation('execution-1', vi.fn())

    expect(order).toEqual(['subscribe', 'read'])
  })

  it('delivers a durable cancellation that predates the subscription', async () => {
    mockRedisExists.mockResolvedValue(1)
    const onCancelled = vi.fn()

    const unsubscribe = await subscribeToExecutionCancellation('execution-1', onCancelled)

    expect(onCancelled).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(mockSignalUnsubscribe).toHaveBeenCalledTimes(1)
  })

  it('re-reads the durable cancellation flag after the signal connection recovers', async () => {
    let signalHandler: ((reason: string) => void) | undefined
    mockSignalSubscribe.mockImplementation(async (_executionId, handler) => {
      signalHandler = handler
      return mockSignalUnsubscribe
    })
    mockRedisExists.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const onCancelled = vi.fn()
    await subscribeToExecutionCancellation('execution-1', onCancelled)

    signalHandler?.('reconnected')

    await vi.waitFor(() => expect(onCancelled).toHaveBeenCalledOnce())
    expect(mockRedisExists).toHaveBeenCalledTimes(2)
  })

  it('queues a fresh durable read when reconnect occurs during an in-flight read', async () => {
    let signalHandler: ((reason: string) => void) | undefined
    mockSignalSubscribe.mockImplementation(async (_executionId, handler) => {
      signalHandler = handler
      return mockSignalUnsubscribe
    })
    let resolveInitialRead!: (value: number) => void
    mockRedisExists
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveInitialRead = resolve
        })
      )
      .mockResolvedValueOnce(1)
    const onCancelled = vi.fn()

    const subscription = subscribeToExecutionCancellation('execution-1', onCancelled)
    await vi.waitFor(() => expect(mockRedisExists).toHaveBeenCalledOnce())
    signalHandler?.('reconnected')
    resolveInitialRead(0)
    await subscription

    expect(mockRedisExists).toHaveBeenCalledTimes(2)
    expect(onCancelled).toHaveBeenCalledOnce()
  })

  it('fails closed when the signal subscription cannot be restored', async () => {
    let signalHandler: ((reason: string) => void) | undefined
    mockSignalSubscribe.mockImplementation(async (_executionId, handler) => {
      signalHandler = handler
      return mockSignalUnsubscribe
    })
    const onCancelled = vi.fn()
    await subscribeToExecutionCancellation('execution-1', onCancelled)

    signalHandler?.('unavailable')

    expect(onCancelled).toHaveBeenCalledOnce()
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
