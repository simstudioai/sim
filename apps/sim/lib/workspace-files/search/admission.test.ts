/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileSearchAdmission } from '@/lib/workspace-files/search/admission'
import { WorkspaceFileSearchUnavailableError } from '@/lib/workspace-files/search/errors'

describe('FileSearchAdmission', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function createAdmission(concurrency = 1, maxPending = 3) {
    return new FileSearchAdmission({ concurrency, maxPending, timeoutMs: 5000 })
  }

  it('queues a burst without exceeding the active budget and releases each slot once', async () => {
    const admission = createAdmission(2)
    const first = await admission.acquire('a')
    const second = await admission.acquire('a')
    const granted = vi.fn()
    const waiting = admission.acquire('a').then((release) => {
      granted()
      return release
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).not.toHaveBeenCalled()
    first()
    const third = await waiting
    first()
    const fourthGranted = vi.fn()
    const fourth = admission.acquire('b').then((release) => {
      fourthGranted()
      return release
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(fourthGranted).not.toHaveBeenCalled()
    second()
    ;(await fourth)()
    third()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rotates waiting workspaces instead of draining one burst first', async () => {
    const admission = createAdmission()
    const first = await admission.acquire('a')
    const order: string[] = []
    const request = (workspace: string) =>
      admission.acquire(workspace).then((release) => {
        order.push(workspace)
        release()
      })
    const waiting = [request('a'), request('a'), request('b')]
    first()
    await Promise.all(waiting)
    expect(order).toEqual(['a', 'b', 'a'])
  })

  it('rejects overflow and recovers when the queue drains', async () => {
    const admission = createAdmission(1, 1)
    const first = await admission.acquire('a')
    const waiting = admission.acquire('a')
    await expect(admission.acquire('b')).rejects.toBeInstanceOf(WorkspaceFileSearchUnavailableError)
    first()
    ;(await waiting)()
    ;(await admission.acquire('b'))()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expires waiting requests without executing them or leaking queue capacity', async () => {
    const admission = createAdmission(1, 1)
    const first = await admission.acquire('a')
    const waiting = expect(admission.acquire('b')).rejects.toBeInstanceOf(
      WorkspaceFileSearchUnavailableError
    )
    await vi.advanceTimersByTimeAsync(5000)
    await waiting
    const next = admission.acquire('c')
    first()
    ;(await next)()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks expiry when granting even if a busy event loop has delayed the timer', async () => {
    const admission = createAdmission()
    const first = await admission.acquire('a')
    const waiting = expect(admission.acquire('b')).rejects.toBeInstanceOf(
      WorkspaceFileSearchUnavailableError
    )
    vi.setSystemTime(Date.now() + 5000)
    first()
    await waiting
    ;(await admission.acquire('c'))()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes cancelled waiters and their listeners without consuming a connection', async () => {
    const admission = createAdmission(1, 1)
    const first = await admission.acquire('a')
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const reason = new Error('cancelled')
    const waiting = expect(admission.acquire('b', controller.signal)).rejects.toBe(reason)
    controller.abort(reason)
    await waiting
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    const next = admission.acquire('c')
    first()
    ;(await next)()
  })

  it('rejects an already cancelled caller without occupying a slot', async () => {
    const admission = createAdmission()
    const reason = new Error('cancelled')
    await expect(admission.acquire('a', AbortSignal.abort(reason))).rejects.toBe(reason)
    ;(await admission.acquire('b'))()
  })

  it('does not recycle an active slot on cancellation until the database work settles', async () => {
    const admission = createAdmission()
    const controller = new AbortController()
    const first = await admission.acquire('a', controller.signal)
    controller.abort()
    const granted = vi.fn()
    const next = admission.acquire('b').then((release) => {
      granted()
      release()
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).not.toHaveBeenCalled()
    first()
    await next
  })
})
