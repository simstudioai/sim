/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listeners, mockRedisUrl, mockSubscribe, mockUnsubscribe } = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  mockRedisUrl: { value: 'redis://localhost:6379' as string | undefined },
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
}))

vi.mock('ioredis', () => ({
  default: class {
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners.set(event, handler)
      return this
    }

    subscribe = mockSubscribe
    unsubscribe = mockUnsubscribe
  },
}))

vi.mock('@/lib/core/config/redis', () => ({
  getConfiguredRedisUrl: () => mockRedisUrl.value,
  getRedisConnectionDefaults: () => ({}),
}))

import {
  getExecutionSignalHub,
  publishLocalExecutionSignal,
} from '@/lib/execution/execution-signal'

describe('ExecutionSignalHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    mockSubscribe.mockResolvedValue(1)
    mockUnsubscribe.mockResolvedValue(0)
    mockRedisUrl.value = 'redis://localhost:6379'
    const signalGlobal = globalThis as typeof globalThis & { _executionSignalHub?: unknown }
    signalGlobal._executionSignalHub = undefined
  })

  it('waits for one shared subscription acknowledgement before resolving concurrent subscribers', async () => {
    let acknowledge: (() => void) | undefined
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        acknowledge = () => resolve(2)
      })
    )
    const hub = getExecutionSignalHub()
    const first = hub.subscribe('execution-1', vi.fn())
    const second = hub.subscribe('execution-1', vi.fn())
    let secondResolved = false
    void second.then(() => {
      secondResolved = true
    })

    await Promise.resolve()
    expect(mockSubscribe).toHaveBeenCalledOnce()
    expect(secondResolved).toBe(false)

    acknowledge?.()
    await Promise.all([first, second])
    expect(secondResolved).toBe(true)
  })

  it('marks every affected subscription unavailable when reconnect acknowledgement fails', async () => {
    const hub = getExecutionSignalHub()
    listeners.get('ready')?.()
    const handler = vi.fn()
    await hub.subscribe('execution-1', handler)
    mockSubscribe.mockRejectedValueOnce(new Error('Redis unavailable'))

    listeners.get('ready')?.()

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('unavailable'))
  })

  it('delivers legacy rolling-deployment cancellations to the matching execution', async () => {
    const hub = getExecutionSignalHub()
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    await hub.subscribe('execution-1', firstHandler)
    await hub.subscribe('execution-2', secondHandler)

    expect(mockSubscribe).toHaveBeenCalledWith('execution:signal:execution-1', 'execution:cancel')
    listeners.get('message')?.('execution:cancel', JSON.stringify({ executionId: 'execution-1' }))

    expect(firstHandler).toHaveBeenCalledWith('cancelled')
    expect(secondHandler).not.toHaveBeenCalled()
  })

  it('deduplicates cancellations published to both rollout channels', async () => {
    const hub = getExecutionSignalHub()
    const handler = vi.fn()
    await hub.subscribe('execution-1', handler)

    listeners.get('message')?.(
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1', executionSignalPublished: true })
    )
    listeners.get('message')?.('execution:signal:execution-1', 'cancelled')

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('cancelled')
  })

  it('does not deliver a stale reconnect failure to a replacement subscriber', async () => {
    const hub = getExecutionSignalHub()
    listeners.get('ready')?.()
    const oldHandler = vi.fn()
    const unsubscribeOld = await hub.subscribe('execution-1', oldHandler)
    let rejectOldReconnect!: (error: Error) => void
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((_resolve, reject) => {
        rejectOldReconnect = reject
      })
    )

    listeners.get('ready')?.()
    unsubscribeOld()
    mockSubscribe.mockResolvedValueOnce(1)
    const replacement = vi.fn()
    await hub.subscribe('execution-1', replacement)
    rejectOldReconnect(new Error('stale reconnect failed'))

    await vi.waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(3))
    expect(replacement).not.toHaveBeenCalledWith('unavailable')
  })

  it('uses a process-local signal hub when Redis is not configured', async () => {
    mockRedisUrl.value = undefined
    const handler = vi.fn()
    await getExecutionSignalHub().subscribe('execution-local', handler)

    publishLocalExecutionSignal('execution-local', 'event')

    expect(handler).toHaveBeenCalledWith('event')
  })
})
