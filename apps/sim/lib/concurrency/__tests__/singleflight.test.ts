/**
 * @vitest-environment node
 */
import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetCoalesceLocallyForTests, coalesceLocally } from '@/lib/concurrency/singleflight'

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

  it('does not coalesce across distinct keys', async () => {
    const fn = vi.fn(async () => 'value')
    await Promise.all([coalesceLocally('a', fn), coalesceLocally('b', fn)])
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
