import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, mockRedisSet } = vi.hoisted(() => ({
  mockGetRedisClient: vi.fn(),
  mockRedisSet: vi.fn(),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { markExecutionCancelled } from './cancellation'
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
