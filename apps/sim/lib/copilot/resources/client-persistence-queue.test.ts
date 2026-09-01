/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourcePersistenceQueue } from '@/lib/copilot/resources/client-persistence-queue'
import type { MothershipResourceUpdate } from '@/lib/copilot/resources/types'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const TABLE_RESOURCE: MothershipResourceUpdate = {
  type: 'table',
  id: 'table-1',
  title: 'Accounts',
}

describe('ResourcePersistenceQueue', () => {
  const onError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drains a newer update after the write for the same resource settles', async () => {
    const first = deferred<unknown>()
    const persist = vi
      .fn<(chatId: string, update: MothershipResourceUpdate) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ success: true })
    const queue = new ResourcePersistenceQueue({ persist, onError })

    queue.enqueue({ ...TABLE_RESOURCE, viewId: 'view-a' }, 'chat-1')
    queue.enqueue({ ...TABLE_RESOURCE, viewId: 'view-b' }, 'chat-1')

    await Promise.resolve()
    expect(persist).toHaveBeenCalledTimes(1)
    const flushed = queue.flush('chat-1')
    first.resolve({ success: true })
    await flushed

    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1]).toEqual(['chat-1', { ...TABLE_RESOURCE, viewId: 'view-b' }])
    expect(queue.pendingKeys.size).toBe(0)
    expect(queue.inFlight.size).toBe(0)
  })

  it('retains the newest desired state after a failure for a later retry', async () => {
    const first = deferred<unknown>()
    const persist = vi
      .fn<(chatId: string, update: MothershipResourceUpdate) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ success: true })
    const queue = new ResourcePersistenceQueue({ persist, onError })

    queue.enqueue({ ...TABLE_RESOURCE, clearViewId: true }, 'chat-1')
    queue.enqueue(TABLE_RESOURCE, 'chat-1')
    first.reject(new Error('offline'))
    await Promise.allSettled(Array.from(queue.inFlight.values()))

    expect(queue.getPendingUpdates()).toEqual([{ ...TABLE_RESOURCE, clearViewId: true }])
    await queue.flush('chat-1')

    expect(persist.mock.calls[1]).toEqual(['chat-1', { ...TABLE_RESOURCE, clearViewId: true }])
    expect(onError).toHaveBeenCalledOnce()
  })

  it('does not let a removed write settle over a fresh add of the same resource', async () => {
    const stale = deferred<unknown>()
    const fresh = deferred<unknown>()
    const persist = vi
      .fn<(chatId: string, update: MothershipResourceUpdate) => Promise<unknown>>()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const queue = new ResourcePersistenceQueue({ persist, onError })

    queue.enqueue({ ...TABLE_RESOURCE, viewId: 'view-a' }, 'chat-1')
    queue.remove(TABLE_RESOURCE.type, TABLE_RESOURCE.id)
    queue.enqueue({ ...TABLE_RESOURCE, viewId: 'view-b' }, 'chat-1')
    stale.resolve({ success: true })
    await Promise.resolve()

    expect(queue.inFlight.size).toBe(1)
    fresh.resolve({ success: true })
    await Promise.allSettled(Array.from(queue.inFlight.values()))
    expect(queue.inFlight.size).toBe(0)
  })
})
