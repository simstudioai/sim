import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withRetry } from './retry'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns result immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 })
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('ok')
    const promise = withRetry(fn, { initialDelayMs: 10, maxRetries: 3 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries up to maxRetries times then throws', async () => {
    const error = Object.assign(new Error('service unavailable'), { status: 503 })
    const fn = vi.fn().mockRejectedValue(error)
    const promise = withRetry(fn, { maxRetries: 3, initialDelayMs: 10 })
    await vi.runAllTimersAsync()
    await expect(promise).rejects.toThrow('service unavailable')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does NOT retry on 400 bad request', async () => {
    const error = Object.assign(new Error('bad request'), { status: 400 })
    const fn = vi.fn().mockRejectedValue(error)
    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 401 unauthorized', async () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 })
    const fn = vi.fn().mockRejectedValue(error)
    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('unauthorized')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on network error with no status code', async () => {
    const error = new Error('network failure')
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('recovered')
    const promise = withRetry(fn, { maxRetries: 3, initialDelayMs: 10 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('respects Retry-After header on 429', async () => {
    const headers = new Headers({ 'retry-after': '2' })
    const error = Object.assign(new Error('rate limited'), { status: 429, headers })
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('ok')
    const promise = withRetry(fn, { maxRetries: 3, initialDelayMs: 100 })
    await vi.runAllTimersAsync()
    await promise
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
