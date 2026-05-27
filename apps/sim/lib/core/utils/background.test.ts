/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight, runDetached } from '@/lib/core/utils/background'

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

describe('createSingleFlight', () => {
  it('starts work and reports active while in flight', async () => {
    const guard = createSingleFlight({ staleAfterMs: 60_000 })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const started = guard.run('task', () => gate)
    expect(started).toBe(true)
    expect(guard.isActive()).toBe(true)

    release()
    await flushMicrotasks()
    expect(guard.isActive()).toBe(false)
  })

  it('refuses a second run while one is already in flight', async () => {
    const guard = createSingleFlight({ staleAfterMs: 60_000 })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    expect(guard.run('task', () => gate)).toBe(true)
    expect(guard.run('task', () => Promise.resolve())).toBe(false)

    release()
    await flushMicrotasks()
    expect(guard.run('task', () => Promise.resolve())).toBe(true)
  })

  it('clears the active flag even when work rejects', async () => {
    const guard = createSingleFlight({ staleAfterMs: 60_000 })

    expect(guard.run('task', () => Promise.reject(new Error('boom')))).toBe(true)
    await flushMicrotasks()
    expect(guard.isActive()).toBe(false)
  })

  it('takes over a stale run whose work never settles', async () => {
    const guard = createSingleFlight({ staleAfterMs: 10 })

    // A run whose promise never settles — its `finally` never fires.
    expect(guard.run('task', () => new Promise<void>(() => {}))).toBe(true)
    expect(guard.run('task', () => Promise.resolve())).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 20))

    const second = vi.fn().mockResolvedValue(undefined)
    expect(guard.run('task', second)).toBe(true)
    await flushMicrotasks()
    expect(second).toHaveBeenCalledTimes(1)
    expect(guard.isActive()).toBe(false)
  })

  it('does not let a late stale run clear a newer run slot', async () => {
    const guard = createSingleFlight({ staleAfterMs: 10 })

    let releaseStale: () => void = () => {}
    const stale = new Promise<void>((resolve) => {
      releaseStale = resolve
    })
    expect(guard.run('task', () => stale)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 20))

    // New run takes over the stale slot.
    let releaseFresh: () => void = () => {}
    const fresh = new Promise<void>((resolve) => {
      releaseFresh = resolve
    })
    expect(guard.run('task', () => fresh)).toBe(true)

    // The original stale run settling late must not release the newer slot.
    releaseStale()
    await flushMicrotasks()
    expect(guard.isActive()).toBe(true)

    releaseFresh()
    await flushMicrotasks()
    expect(guard.isActive()).toBe(false)
  })
})
