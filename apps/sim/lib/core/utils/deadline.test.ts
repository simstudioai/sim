/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeadlineExceededError, withinDeadline } from '@/lib/core/utils/deadline'

afterEach(() => vi.useRealTimers())

describe('bounded asynchronous operations', () => {
  it('aborts a stalled wait and fences subsequent work when the dependency eventually returns', async () => {
    vi.useFakeTimers()
    let resolve!: () => void
    const stalled = new Promise<void>((done) => {
      resolve = done
    })
    const mutate = vi.fn()
    const operation = withinDeadline(async (signal) => {
      await stalled
      signal.throwIfAborted()
      mutate()
    }, Date.now() + 100)
    const rejection = expect(operation).rejects.toBeInstanceOf(DeadlineExceededError)
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    resolve()
    await vi.advanceTimersByTimeAsync(1)
    expect(mutate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an expired deadline before starting dependency work', async () => {
    const dependency = vi.fn()
    await expect(withinDeadline(dependency, Date.now() - 1)).rejects.toBeInstanceOf(
      DeadlineExceededError
    )
    expect(dependency).not.toHaveBeenCalled()
  })

  it('clears its timer after successful completion and propagates caller cancellation', async () => {
    vi.useFakeTimers()
    await expect(withinDeadline(async () => 7, Date.now() + 100)).resolves.toBe(7)
    expect(vi.getTimerCount()).toBe(0)
    const controller = new AbortController()
    const operation = withinDeadline(
      () => new Promise(() => {}),
      Date.now() + 100,
      controller.signal
    )
    const rejection = expect(operation).rejects.toThrow('Cancelled fixture')
    controller.abort(new Error('Cancelled fixture'))
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
})
