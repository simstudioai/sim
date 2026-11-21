import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mutateProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity-store'

const evalScript = vi.fn()
const getRedis = redisConfigMockFns.mockGetRedisClient

const CONFIG = {
  requestsPerMinute: 60,
  pagesPerMinute: 1000,
  initialPageTokens: 30,
  maxConcurrent: 2,
  recoveryIntervalMs: 60_000,
  minimumScale: 0.1,
}
const ACTION = { kind: 'acquire', leaseId: 'lease', pages: 30, leaseDurationMs: 120_000 } as const
const RESULT = { allowed: true, retryAfterMs: 0, scale: 1, inFlight: 1 }

describe('provider capacity storage bounds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getRedis.mockReturnValue({ eval: evalScript })
    evalScript.mockResolvedValue(JSON.stringify(RESULT))
  })
  afterEach(() => vi.useRealTimers())

  it('sends a backend admission cutoff and cleans up deadline timers on success', async () => {
    const deadline = Date.now() + 5000
    expect(await mutateProviderCapacity('quota', CONFIG, ACTION, deadline)).toEqual(RESULT)
    expect(evalScript.mock.calls[0]?.[5]).toBe(String(deadline))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a stalled Redis connection independently of the driver', async () => {
    evalScript.mockImplementation(() => new Promise(() => undefined))
    const pending = mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
    const rejected = expect(pending).rejects.toThrow('deadline expired')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors caller cancellation during a stalled Redis command', async () => {
    evalScript.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController()
    const pending = mutateProviderCapacity(
      'quota',
      CONFIG,
      ACTION,
      Date.now() + 5000,
      controller.signal
    )
    const rejected = expect(pending).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails closed when Redis is not configured or gives malformed state', async () => {
    getRedis.mockImplementationOnce(() => {
      throw new Error('REDIS_URL is required')
    })
    await expect(
      mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
    ).rejects.toThrow('REDIS_URL is required')
    evalScript.mockResolvedValueOnce(JSON.stringify({ ...RESULT, scale: 100 }))
    await expect(
      mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
    ).rejects.toThrow('Invalid provider capacity storage response')
  })

  it('never contacts storage for already aborted or expired calls', async () => {
    await expect(mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() - 1)).rejects.toThrow(
      'deadline expired'
    )
    await expect(
      mutateProviderCapacity(
        'quota',
        CONFIG,
        ACTION,
        Date.now() + 5000,
        AbortSignal.abort(new Error('cancelled'))
      )
    ).rejects.toThrow('cancelled')
    expect(evalScript).not.toHaveBeenCalled()
  })
})
