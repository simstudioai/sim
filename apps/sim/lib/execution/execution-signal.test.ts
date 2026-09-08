/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connection, mockRedisUrl, mockSubscribe, mockUnsubscribe } = vi.hoisted(() => ({
  connection: {
    status: 'ready',
    client: undefined as EventEmitter | undefined,
  },
  mockRedisUrl: { value: 'redis://localhost:6379' as string | undefined },
  mockSubscribe: vi.fn(),
  mockUnsubscribe: vi.fn(),
}))

vi.mock('ioredis', () => ({
  default: class extends EventEmitter {
    constructor() {
      super()
      connection.client = this
    }

    get status() {
      return connection.status
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
    connection.status = 'ready'
    connection.client = undefined
    mockSubscribe.mockResolvedValue(1)
    mockUnsubscribe.mockResolvedValue(0)
    mockRedisUrl.value = 'redis://localhost:6379'
    const signalGlobal = globalThis as typeof globalThis & { _executionSignalHub?: unknown }
    signalGlobal._executionSignalHub = undefined
  })

  it.each(['connecting', 'connect', 'reconnecting'])(
    'waits for Redis readiness while %s before subscribing concurrent execution channels',
    async (status) => {
      connection.status = status
      const hub = getExecutionSignalHub()
      const subscriptions = Array.from({ length: 12 }, (_, index) =>
        hub.subscribe(`execution-${index}`, vi.fn())
      )

      await Promise.resolve()
      expect(mockSubscribe).not.toHaveBeenCalled()
      expect(connection.client?.listenerCount('ready')).toBeLessThanOrEqual(2)

      connection.status = 'ready'
      connection.client?.emit('ready')
      await Promise.all(subscriptions)

      expect(mockSubscribe).toHaveBeenCalledTimes(12)
      expect(connection.client?.listenerCount('ready')).toBe(1)
      expect(connection.client?.listenerCount('error')).toBe(1)
      expect(connection.client?.listenerCount('end')).toBe(0)
    }
  )

  it('rechecks readiness when the connection closes before waiting subscriptions resume', async () => {
    connection.status = 'connect'
    const hub = getExecutionSignalHub()
    const subscription = hub.subscribe('execution-1', vi.fn())

    connection.status = 'ready'
    connection.client?.emit('ready')
    connection.status = 'connect'
    connection.client?.emit('close')
    await vi.waitFor(() => expect(connection.client?.listenerCount('ready')).toBe(2))
    expect(mockSubscribe).not.toHaveBeenCalled()

    connection.status = 'ready'
    connection.client?.emit('ready')
    await subscription
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('rejects immediately when the subscriber has already ended', async () => {
    connection.status = 'end'

    await expect(getExecutionSignalHub().subscribe('execution-1', vi.fn())).rejects.toThrow(
      'Redis subscriber connection ended'
    )
    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(connection.client?.listenerCount('ready')).toBe(1)
  })

  it('does not subscribe new channels while Redis is reconnecting', async () => {
    const hub = getExecutionSignalHub()
    connection.client?.emit('ready')
    const handler = vi.fn()
    await hub.subscribe('execution-existing', handler)
    mockSubscribe.mockClear()
    connection.status = 'connect'
    connection.client?.emit('close')
    const subscription = hub.subscribe('execution-new', vi.fn())

    await Promise.resolve()
    expect(mockSubscribe).not.toHaveBeenCalled()

    connection.status = 'ready'
    connection.client?.emit('ready')
    await subscription
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('reconnected'))
    expect(mockSubscribe).toHaveBeenCalledWith('execution:signal:execution-new', 'execution:cancel')
  })

  it.each(['error', 'end'])(
    'rejects readiness waiters on %s and allows a fresh attempt',
    async (event) => {
      connection.status = 'connect'
      const hub = getExecutionSignalHub()
      const handler = vi.fn()
      const subscription = hub.subscribe('execution-1', handler)
      const rejected = expect(subscription).rejects.toThrow('Execution signal subscription failed:')

      connection.status = 'end'
      connection.client?.emit(event, new Error('connection failed'))
      await rejected
      expect(mockSubscribe).not.toHaveBeenCalled()
      expect(connection.client?.listenerCount('ready')).toBe(1)
      expect(connection.client?.listenerCount('error')).toBe(1)
      expect(connection.client?.listenerCount('end')).toBe(0)

      connection.status = 'ready'
      connection.client?.emit('ready')
      await hub.subscribe('execution-1', handler)
      expect(mockSubscribe).toHaveBeenCalledOnce()
    }
  )

  it('bounds the readiness wait and removes failed handlers before a later ready event', async () => {
    vi.useFakeTimers()
    try {
      connection.status = 'connect'
      const hub = getExecutionSignalHub()
      const handler = vi.fn()
      const subscription = hub.subscribe('execution-1', handler)
      const rejected = expect(subscription).rejects.toThrow(
        'Timed out waiting for Redis subscriber readiness'
      )

      await Promise.all([rejected, vi.advanceTimersByTimeAsync(5000)])
      expect(mockSubscribe).not.toHaveBeenCalled()
      expect(connection.client?.listenerCount('ready')).toBe(1)
      expect(connection.client?.listenerCount('error')).toBe(1)
      expect(connection.client?.listenerCount('end')).toBe(0)
      expect(vi.getTimerCount()).toBe(0)

      connection.status = 'ready'
      connection.client?.emit('ready')
      connection.client?.emit('message', 'execution:signal:execution-1', 'cancelled')
      expect(handler).not.toHaveBeenCalled()
      await hub.subscribe('execution-1', handler)
      expect(mockSubscribe).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
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
    connection.client?.emit('ready')
    const handler = vi.fn()
    await hub.subscribe('execution-1', handler)
    mockSubscribe.mockRejectedValueOnce(new Error('Redis unavailable'))

    connection.client?.emit('ready')

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('unavailable'))
  })

  it('delivers legacy rolling-deployment cancellations to the matching execution', async () => {
    const hub = getExecutionSignalHub()
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    await hub.subscribe('execution-1', firstHandler)
    await hub.subscribe('execution-2', secondHandler)

    expect(mockSubscribe).toHaveBeenCalledWith('execution:signal:execution-1', 'execution:cancel')
    connection.client?.emit(
      'message',
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1' })
    )

    expect(firstHandler).toHaveBeenCalledWith('cancelled')
    expect(secondHandler).not.toHaveBeenCalled()
  })

  it('deduplicates cancellations published to both rollout channels', async () => {
    const hub = getExecutionSignalHub()
    const handler = vi.fn()
    await hub.subscribe('execution-1', handler)

    connection.client?.emit(
      'message',
      'execution:cancel',
      JSON.stringify({ executionId: 'execution-1', executionSignalPublished: true })
    )
    connection.client?.emit('message', 'execution:signal:execution-1', 'cancelled')

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('cancelled')
  })

  it('does not deliver a stale reconnect failure to a replacement subscriber', async () => {
    const hub = getExecutionSignalHub()
    connection.client?.emit('ready')
    const oldHandler = vi.fn()
    const unsubscribeOld = await hub.subscribe('execution-1', oldHandler)
    let rejectOldReconnect!: (error: Error) => void
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((_resolve, reject) => {
        rejectOldReconnect = reject
      })
    )

    connection.client?.emit('ready')
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
