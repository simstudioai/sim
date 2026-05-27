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
    const guard = createSingleFlight()
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
    const guard = createSingleFlight()
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
    const guard = createSingleFlight()

    expect(guard.run('task', () => Promise.reject(new Error('boom')))).toBe(true)
    await flushMicrotasks()
    expect(guard.isActive()).toBe(false)
  })
})
