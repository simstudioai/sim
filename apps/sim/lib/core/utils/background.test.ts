/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { runDetached } from '@/lib/core/utils/background'

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runDetached', () => {
  it('runs the work without the caller awaiting it', async () => {
    const work = vi.fn().mockResolvedValue(undefined)

    runDetached('test', work)

    await flushMicrotasks()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('swallows rejections so they do not surface as unhandled', async () => {
    const work = vi.fn().mockRejectedValue(new Error('boom'))

    expect(() => runDetached('test', work)).not.toThrow()
    await flushMicrotasks()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('swallows synchronous throws from work', async () => {
    const work = vi.fn(() => {
      throw new Error('sync boom')
    })

    expect(() => runDetached('test', work)).not.toThrow()
    await flushMicrotasks()
  })
})
