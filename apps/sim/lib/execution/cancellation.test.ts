import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRedisSet, mockPublish, mockSubscribe } = vi.hoisted(() => ({
  mockRedisSet: vi.fn(),
  mockPublish: vi.fn(),
  mockSubscribe: vi.fn(),
}))

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({
    publish: mockPublish,
    subscribe: mockSubscribe,
    dispose: vi.fn(),
  }),
}))

import { getCancellationChannel, markExecutionCancelled } from './cancellation'
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
    unregisterManualExecutionAborter('execution-1')
  })

  it('aborts registered executions', () => {
    const abort = vi.fn()

    registerManualExecutionAborter('execution-1', abort)

    expect(abortManualExecution('execution-1')).toBe(true)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('returns false when no execution is registered', () => {
    expect(abortManualExecution('execution-missing')).toBe(false)
  })

  it('unregisters executions', () => {
    const abort = vi.fn()

    registerManualExecutionAborter('execution-1', abort)
    unregisterManualExecutionAborter('execution-1')

    expect(abortManualExecution('execution-1')).toBe(false)
    expect(abort).not.toHaveBeenCalled()
  })
})
