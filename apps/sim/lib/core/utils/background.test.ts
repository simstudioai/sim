import { flushMacrotask } from '@sim/testing/helpers/async'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'
import { createDetachedTouch, runDetached } from '@/lib/core/utils/background'

describe('runDetached', () => {
  it('swallows rejections so they do not surface as unhandled', async () => {
    const work = vi.fn().mockRejectedValue(new Error('boom'))

    expect(() => runDetached('test', work)).not.toThrow()
    await flushMacrotask()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('swallows synchronous throws from work', async () => {
    const work = vi.fn(() => {
      throw new Error('sync boom')
    })

    expect(() => runDetached('test', work)).not.toThrow()
    await flushMacrotask()
  })
})

describe('createDetachedTouch', () => {
  const pendingWrite = () => {
    let settle = () => {}
    const promise = new Promise<void>((resolve) => {
      settle = resolve
    })
    return { promise, settle }
  }

  it('returns before the write settles and skips repeats inside the interval', () => {
    const write = vi.fn(() => new Promise<void>(() => {}))
    const touch = createDetachedTouch({
      label: 'test',
      write,
      debounce: { intervalMs: 60_000, maxKeys: 10 },
    })

    expect(touch('a')).toBeUndefined()
    touch('a')
    touch('b')

    return flushMacrotask().then(() => {
      expect(write.mock.calls).toEqual([['a'], ['b']])
    })
  })

  it('never starts a second write for a key while its first is still pending', async () => {
    const first = pendingWrite()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const touch = createDetachedTouch({
      label: 'test',
      write,
      debounce: { intervalMs: 1, maxKeys: 1 },
    })

    touch('a')
    await sleep(5)
    touch('b')
    touch('a')
    await flushMacrotask()
    expect(write.mock.calls).toEqual([['a'], ['b']])

    first.settle()
    await flushMacrotask()
    await sleep(5)
    touch('a')
    await flushMacrotask()
    expect(write.mock.calls).toEqual([['a'], ['b'], ['a']])
  })

  it('releases a key whose write failed', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const touch = createDetachedTouch({ label: 'test', write })

    touch('a')
    await flushMacrotask()
    await sleep(5)
    touch('a')
    await flushMacrotask()
    expect(write).toHaveBeenCalledTimes(2)
  })
})
