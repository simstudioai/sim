/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCoalesceLocallyForTests,
  CoalesceSettleTimeoutError,
  coalesceLocally,
} from '@/lib/concurrency/singleflight'

afterEach(() => {
  __resetCoalesceLocallyForTests()
  vi.restoreAllMocks()
})

describe('coalesceLocally', () => {
  it('invokes fn once when N callers race on the same key', async () => {
    const fn = vi.fn(async () => {
      await sleep(5)
      return 'value'
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => coalesceLocally('shared', fn))
    )

    expect(fn).toHaveBeenCalledTimes(1)
    expect(results).toEqual(Array.from({ length: 10 }, () => 'value'))
  })

  it('returns the same promise instance to concurrent callers', () => {
    const fn = async () => {
      await sleep(10)
      return 1
    }
    const a = coalesceLocally('same-key', fn)
    const b = coalesceLocally('same-key', fn)
    expect(a).toBe(b)
  })

  it('clears the cache after success so the next call invokes fn again', async () => {
    let count = 0
    const fn = async () => {
      count += 1
      return count
    }

    expect(await coalesceLocally('once', fn)).toBe(1)
    expect(await coalesceLocally('once', fn)).toBe(2)
  })

  it('clears the cache after rejection so the next call invokes fn again', async () => {
    let count = 0
    const fn = async () => {
      count += 1
      throw new Error(`fail ${count}`)
    }

    await expect(coalesceLocally('rejection', fn)).rejects.toThrow('fail 1')
    await expect(coalesceLocally('rejection', fn)).rejects.toThrow('fail 2')
  })

  it('surfaces a synchronously-thrown fn error and evicts the entry', async () => {
    const fn = vi.fn((): Promise<string> => {
      throw new Error('sync boom')
    })

    // The real error must surface (not a TDZ ReferenceError from the evict
    // closure) and the entry must be evicted so the next call retries.
    await expect(coalesceLocally('sync-throw', fn)).rejects.toThrow('sync boom')
    await expect(coalesceLocally('sync-throw', fn)).rejects.toThrow('sync boom')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce across distinct keys', async () => {
    const fn = vi.fn(async () => 'value')
    await Promise.all([coalesceLocally('a', fn), coalesceLocally('b', fn)])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('rejects all awaiters and evicts the entry when the producer misses the settle deadline', async () => {
    vi.useFakeTimers()
    try {
      let resolveHung: (value: string) => void
      const hung = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveHung = resolve
          })
      )

      const a = coalesceLocally('wedged', hung)
      const b = coalesceLocally('wedged', hung)
      const aAssertion = expect(a).rejects.toBeInstanceOf(CoalesceSettleTimeoutError)
      const bAssertion = expect(b).rejects.toBeInstanceOf(CoalesceSettleTimeoutError)

      await vi.advanceTimersByTimeAsync(30_000)
      await aAssertion
      await bAssertion
      expect(hung).toHaveBeenCalledTimes(1)

      const fresh = vi.fn(async () => 'recovered')
      await expect(coalesceLocally('wedged', fresh)).resolves.toBe('recovered')
      expect(fresh).toHaveBeenCalledTimes(1)

      resolveHung!('late')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a timed-out producer settling late does not evict its successor', async () => {
    vi.useFakeTimers()
    try {
      let resolveOld: (value: string) => void
      const old = coalesceLocally(
        'late-settle',
        () =>
          new Promise<string>((resolve) => {
            resolveOld = resolve
          }),
        1_000
      )
      const oldAssertion = expect(old).rejects.toBeInstanceOf(CoalesceSettleTimeoutError)
      await vi.advanceTimersByTimeAsync(1_000)
      await oldAssertion

      let resolveNew: (value: string) => void
      const successor = coalesceLocally(
        'late-settle',
        () =>
          new Promise<string>((resolve) => {
            resolveNew = resolve
          })
      )

      resolveOld!('late')
      await vi.advanceTimersByTimeAsync(0)

      const joined = coalesceLocally('late-settle', async () => 'should-not-run')
      expect(joined).toBe(successor)

      resolveNew!('new-value')
      await expect(successor).resolves.toBe('new-value')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the deadline for producers that settle in time', async () => {
    vi.useFakeTimers()
    try {
      const value = await coalesceLocally('prompt', async () => 'ok', 1_000)
      expect(value).toBe('ok')

      await vi.advanceTimersByTimeAsync(2_000)
      await expect(coalesceLocally('prompt', async () => 'again', 1_000)).resolves.toBe('again')
    } finally {
      vi.useRealTimers()
    }
  })
})
