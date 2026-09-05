/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'
import {
  AWS_FANOUT_CONCURRENCY,
  mapWithConcurrency,
  withThrottleRetry,
} from '@/lib/internal/identity-center/concurrency'

function throttlingError(): Error {
  const error = new Error('Rate exceeded')
  error.name = 'ThrottlingException'
  return error
}

describe('mapWithConcurrency', () => {
  it('preserves input order in the result', async () => {
    const items = [5, 4, 3, 2, 1]
    const results = await mapWithConcurrency(items, 3, async (item) => {
      await sleep(item)
      return item * 2
    })
    expect(results).toEqual([10, 8, 6, 4, 2])
  })

  it('never exceeds the concurrency ceiling', async () => {
    const items = Array.from({ length: 100 }, (_, index) => index)
    let inFlight = 0
    let peak = 0

    await mapWithConcurrency(items, AWS_FANOUT_CONCURRENCY, async (item) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await sleep(1)
      inFlight--
      return item
    })

    expect(peak).toBeLessThanOrEqual(AWS_FANOUT_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
  })

  it('stops starting work after a rejection', async () => {
    const items = Array.from({ length: 40 }, (_, index) => index)
    let started = 0

    await expect(
      mapWithConcurrency(items, 2, async (item) => {
        started++
        await sleep(1)
        if (item === 0) throw new Error('boom')
        return item
      })
    ).rejects.toThrow('boom')

    expect(started).toBeLessThan(items.length)
  })
})

describe('withThrottleRetry', () => {
  it('retries a throttled call until it succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(throttlingError())
      .mockRejectedValueOnce(throttlingError())
      .mockResolvedValue('ok')

    await expect(withThrottleRetry(operation)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-throttling failure', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('AccessDeniedException'))

    await expect(withThrottleRetry(operation)).rejects.toThrow('AccessDeniedException')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt ceiling', async () => {
    const operation = vi.fn().mockRejectedValue(throttlingError())

    await expect(withThrottleRetry(operation)).rejects.toThrow('Rate exceeded')
    expect(operation).toHaveBeenCalledTimes(4)
  })

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const operation = vi.fn()

    await expect(withThrottleRetry(operation, controller.signal)).rejects.toThrow()
    expect(operation).not.toHaveBeenCalled()
  })
})
