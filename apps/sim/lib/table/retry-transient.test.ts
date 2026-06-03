/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSleep } = vi.hoisted(() => ({ mockSleep: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@sim/utils/helpers', () => ({ sleep: mockSleep }))

import { isRetryableCellError, retryTransient } from '@/lib/table/retry-transient'

function connError(): Error {
  return Object.assign(new Error('Failed query: select ...'), { code: 'ECONNRESET' })
}

function redisTimeout(): Error {
  return new Error('Command timed out')
}

describe('isRetryableCellError', () => {
  it('classifies dropped Postgres connections (network errno) as retryable', () => {
    expect(isRetryableCellError(connError())).toBe(true)
  })

  it('classifies ioredis command timeouts as retryable', () => {
    expect(isRetryableCellError(redisTimeout())).toBe(true)
    expect(isRetryableCellError(new Error('Connection is closed'))).toBe(true)
  })

  it('does not retry application/logic errors', () => {
    expect(isRetryableCellError(new Error('row not found'))).toBe(false)
  })
})

describe('retryTransient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSleep.mockResolvedValue(undefined)
  })

  it('returns the result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retryTransient('t', fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('retries a transient failure then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(connError())
      .mockRejectedValueOnce(redisTimeout())
      .mockResolvedValue('recovered')
    await expect(retryTransient('t', fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenCalledTimes(2)
  })

  it('rethrows a non-transient error immediately without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('row not found'))
    await expect(retryTransient('t', fn)).rejects.toThrow('row not found')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('rethrows after exhausting maxAttempts on a persistent transient error', async () => {
    const fn = vi.fn().mockRejectedValue(connError())
    await expect(retryTransient('t', fn, { maxAttempts: 3 })).rejects.toThrow('Failed query')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenCalledTimes(2)
  })

  it('does not retry once the signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn().mockRejectedValue(connError())
    await expect(retryTransient('t', fn, { signal: controller.signal })).rejects.toThrow(
      'Failed query'
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mockSleep).not.toHaveBeenCalled()
  })
})
