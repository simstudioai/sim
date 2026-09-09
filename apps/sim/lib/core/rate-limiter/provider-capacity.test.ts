/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('@/lib/core/rate-limiter/provider-capacity-store', () => ({
  mutateProviderCapacity: mutate,
}))

import { acquireProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity'

const CONFIG = {
  requestsPerMinute: 60,
  pagesPerMinute: 1000,
  initialPageTokens: 30,
  maxConcurrent: 2,
  recoveryIntervalMs: 60_000,
  minimumScale: 0.1,
}
const INPUT = { providerId: 'mistral', scope: 'organization-hash', pages: 30, config: CONFIG }
const ADMITTED = { allowed: true, retryAfterMs: 0, scale: 1, inFlight: 1 }

describe('provider capacity leases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mutate.mockResolvedValue(ADMITTED)
  })
  afterEach(() => vi.useRealTimers())

  it('shares organization capacity with a bounded deadline and server-clock lease duration', async () => {
    await acquireProviderCapacity({ ...INPUT, deadlineAt: Date.now() + 120_000 })
    expect(mutate).toHaveBeenCalledWith(
      'provider:ocr:mistral:organization-hash:capacity:v1',
      CONFIG,
      expect.objectContaining({ kind: 'acquire', pages: 30, leaseDurationMs: 126_000 }),
      Date.now() + 5000,
      undefined
    )
  })

  it('defers long capacity waits without sending another reservation', async () => {
    mutate.mockResolvedValue({ ...ADMITTED, allowed: false, retryAfterMs: 60_000 })
    await expect(
      acquireProviderCapacity({ ...INPUT, deadlineAt: Date.now() + 120_000 })
    ).rejects.toMatchObject({
      name: 'ProviderCapacityDeferredError',
      reason: 'admission_timeout',
      retryAfterMs: 60_000,
      retryable: false,
    })
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('permits an interactive caller to wait while remaining within its deadline', async () => {
    mutate.mockResolvedValueOnce({ ...ADMITTED, allowed: false, retryAfterMs: 60_000 })
    const pending = acquireProviderCapacity({
      ...INPUT,
      maxWaitMs: 120_000,
      deadlineAt: Date.now() + 120_000,
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await pending
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate.mock.calls[1]?.[2]).toMatchObject({ leaseDurationMs: 66_000 })
  })

  it('defers a known shared throttle immediately even when ordinary admission may wait longer', async () => {
    mutate.mockResolvedValue({
      ...ADMITTED,
      allowed: false,
      retryAfterMs: 60_000,
      cooldownRemainingMs: 60_000,
    })
    const startedAt = Date.now()
    await expect(
      acquireProviderCapacity({ ...INPUT, maxWaitMs: 120_000, deadlineAt: startedAt + 150_000 })
    ).rejects.toMatchObject({ reason: 'rate_limit', retryAfterMs: 60_000 })
    expect(Date.now()).toBe(startedAt)
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent settlement and applies throttle feedback exactly once', async () => {
    const lease = await acquireProviderCapacity({ ...INPUT, deadlineAt: Date.now() + 120_000 })
    mutate.mockResolvedValue({ ...ADMITTED, scale: 0.5, retryAfterMs: 60_000, inFlight: 0 })
    expect(
      await Promise.all([lease.settle('rate_limit', 60_000), lease.settle('rate_limit', 60_000)])
    ).toEqual([60_000, 60_000])
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate.mock.calls[1]?.[2]).toMatchObject({
      kind: 'settle',
      outcome: 'rate_limit',
      retryAfterMs: 60_000,
    })
  })

  it('allows failed settlement to be retried with the same lease identity', async () => {
    const lease = await acquireProviderCapacity({ ...INPUT, deadlineAt: Date.now() + 120_000 })
    mutate.mockRejectedValueOnce(new Error('connection lost'))
    await expect(lease.settle('failure')).rejects.toThrow('connection lost')
    await lease.settle('failure')
    expect(mutate.mock.calls[1]?.[2]?.leaseId).toBe(mutate.mock.calls[2]?.[2]?.leaseId)
  })

  it('preserves caller cancellation and releases a raced admission', async () => {
    const controller = new AbortController()
    mutate.mockImplementationOnce(async () => {
      controller.abort(new Error('caller cancelled'))
      return ADMITTED
    })
    await expect(
      acquireProviderCapacity({
        ...INPUT,
        deadlineAt: Date.now() + 120_000,
        signal: controller.signal,
      })
    ).rejects.toThrow('caller cancelled')
    expect(mutate.mock.calls[1]?.[2]).toMatchObject({ kind: 'settle', outcome: 'failure' })
    expect(mutate.mock.calls[1]?.[4]).toBeUndefined()
  })

  it('fails closed on storage errors and rejects impossible budgets before touching storage', async () => {
    mutate.mockRejectedValueOnce(new Error('Redis offline'))
    await expect(
      acquireProviderCapacity({ ...INPUT, deadlineAt: Date.now() + 120_000 })
    ).rejects.toMatchObject({ reason: 'admission_unavailable', retryAfterMs: 5000 })
    mutate.mockClear()
    await expect(
      acquireProviderCapacity({
        ...INPUT,
        pages: 31,
        config: { ...CONFIG, pagesPerMinute: 30 },
        deadlineAt: Date.now() + 120_000,
      })
    ).rejects.toThrow('configured page budget')
    expect(mutate).not.toHaveBeenCalled()
  })
})
