/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { evalScript, transaction, getRedis, getStorage } = vi.hoisted(() => ({
  evalScript: vi.fn(),
  transaction: vi.fn(),
  getRedis: vi.fn(),
  getStorage: vi.fn(),
}))
vi.mock('@sim/db', () => ({ db: { transaction } }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: getRedis }))
vi.mock('@/lib/core/storage', () => ({ getStorageMethod: getStorage }))

import { mutateProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity-store'

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
    vi.clearAllMocks()
    getStorage.mockReturnValue('redis')
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

  it.each(['redis', 'database'])(
    'bounds a stalled %s connection independently of the driver',
    async (backend) => {
      getStorage.mockReturnValue(backend)
      evalScript.mockImplementation(() => new Promise(() => undefined))
      transaction.mockImplementation(() => new Promise(() => undefined))
      const pending = mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
      const rejected = expect(pending).rejects.toThrow('storage deadline expired')
      await vi.advanceTimersByTimeAsync(5000)
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('honors caller cancellation during a stalled Redis command without falling back to DB', async () => {
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
    expect(transaction).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails closed when configured Redis is missing or gives malformed state', async () => {
    getRedis.mockReturnValueOnce(null)
    await expect(
      mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
    ).rejects.toThrow('Redis is unavailable')
    evalScript.mockResolvedValueOnce(JSON.stringify({ ...RESULT, scale: 100 }))
    await expect(
      mutateProviderCapacity('quota', CONFIG, ACTION, Date.now() + 5000)
    ).rejects.toThrow('Invalid provider capacity storage response')
    expect(transaction).not.toHaveBeenCalled()
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
