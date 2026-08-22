import { describe, expect, it, vi } from 'vitest'
import { runWithConcurrency } from '@/lib/uploads/client/concurrency'

describe('runWithConcurrency', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid concurrency limit %s',
    async (limit) => {
      await expect(runWithConcurrency([1], limit, async (item) => item)).rejects.toThrow(
        'Concurrency limit must be a positive safe integer'
      )
    }
  )

  it('preserves input order while bounding concurrency', async () => {
    let active = 0
    let peak = 0
    const release: Array<() => void> = []
    const worker = vi.fn(async (item: number) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => release.push(resolve))
      active -= 1
      return item * 2
    })

    const resultPromise = runWithConcurrency([1, 2, 3], 2, worker)
    await Promise.resolve()
    expect(worker).toHaveBeenCalledTimes(2)

    release.shift()?.()
    release.shift()?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(worker).toHaveBeenCalledTimes(3)
    release.shift()?.()

    await expect(resultPromise).resolves.toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
    ])
    expect(peak).toBe(2)
  })
})
