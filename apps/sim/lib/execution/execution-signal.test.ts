/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { connection, mockRedisUrl, mockSubscribe, mockUnsubscribe, budgetInputs } = vi.hoisted(
  () => ({
    connection: {
      status: 'ready',
      client: undefined as EventEmitter | undefined,
      options: undefined as Record<string, unknown> | undefined,
    },
    mockRedisUrl: {
      value: 'redis://localhost:6379' as string | undefined,
      error: undefined as Error | undefined,
    },
    mockSubscribe: vi.fn(),
    mockUnsubscribe: vi.fn(),
    // A plain object, not a spy: the budget is computed once at module load, and
    // `vi.clearAllMocks()` in beforeEach would erase a spy's record of that call.
    budgetInputs: { value: undefined as unknown },
  })
)

vi.mock('ioredis', () => ({
  default: class extends EventEmitter {
    constructor(_url: string, options: Record<string, unknown>) {
      super()
      connection.client = this
      connection.options = options
    }

    get status() {
      return connection.status
    }

    subscribe = mockSubscribe
    unsubscribe = mockUnsubscribe
  },
}))

vi.mock('@/lib/core/config/redis', async () => {
  const { redisConfigMock } = await import('@sim/testing')
  return {
    getConfiguredRedisUrl: () => {
      if (mockRedisUrl.error) throw mockRedisUrl.error
      return mockRedisUrl.value
    },
    getRedisConnectionDefaults: () => ({}),
    // Records the inputs, then answers with the shared mirror of the real
    // arithmetic so the derived budget here is the number production derives.
    coldConnectionBudgetMs: (
      inputs: Parameters<typeof redisConfigMock.coldConnectionBudgetMs>[0]
    ) => {
      budgetInputs.value = inputs
      return redisConfigMock.coldConnectionBudgetMs(inputs)
    },
  }
})

import {
  getExecutionSignalHub,
  publishLocalExecutionSignal,
  SUBSCRIBER_READY_TIMEOUT_MS,
  warmExecutionSignalHub,
} from '@/lib/execution/execution-signal'

describe('ExecutionSignalHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.status = 'ready'
    connection.client = undefined
    mockSubscribe.mockResolvedValue(1)
    mockUnsubscribe.mockResolvedValue(0)
    mockRedisUrl.value = 'redis://localhost:6379'
    mockRedisUrl.error = undefined
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

  it('keeps waiting through recoverable connection errors', async () => {
    connection.status = 'connecting'
    const hub = getExecutionSignalHub()
    const handler = vi.fn()
    const subscription = hub.subscribe('execution-1', handler)
    const settled = vi.fn()
    void subscription.then(settled, settled)

    connection.client?.emit('error', new Error('ECONNREFUSED'))
    connection.status = 'reconnecting'
    connection.client?.emit('close')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(mockSubscribe).not.toHaveBeenCalled()

    connection.status = 'ready'
    connection.client?.emit('ready')
    await subscription
    expect(mockSubscribe).toHaveBeenCalledOnce()
    connection.client?.emit('message', 'execution:signal:execution-1', 'cancelled')
    expect(handler).toHaveBeenCalledWith('cancelled')
  })

  it('rejects readiness waiters when the subscriber stops reconnecting', async () => {
    connection.status = 'connect'
    const hub = getExecutionSignalHub()
    const subscription = hub.subscribe('execution-1', vi.fn())
    const rejected = expect(subscription).rejects.toThrow('Redis subscriber connection ended')

    connection.status = 'end'
    connection.client?.emit('end')
    await rejected
    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(connection.client?.listenerCount('ready')).toBe(1)
    expect(connection.client?.listenerCount('error')).toBe(1)
    expect(connection.client?.listenerCount('end')).toBe(0)
  })

  it('keeps a new channel independent of an existing channel reconnect failure', async () => {
    const hub = getExecutionSignalHub()
    connection.client?.emit('ready')
    const existingHandler = vi.fn()
    await hub.subscribe('execution-existing', existingHandler)
    mockSubscribe.mockClear()
    connection.status = 'reconnecting'
    connection.client?.emit('close')
    const newHandler = vi.fn()
    const subscription = hub.subscribe('execution-new', newHandler)
    let rejectReconnect!: (error: Error) => void
    let acknowledgeNew!: (count: number) => void
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((_resolve, reject) => {
        rejectReconnect = reject
      })
    )
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        acknowledgeNew = resolve
      })
    )

    connection.status = 'ready'
    connection.client?.emit('ready')
    await vi.waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(2))
    expect(mockSubscribe).toHaveBeenNthCalledWith(
      1,
      'execution:signal:execution-existing',
      'execution:cancel'
    )
    expect(mockSubscribe).toHaveBeenNthCalledWith(
      2,
      'execution:signal:execution-new',
      'execution:cancel'
    )

    rejectReconnect(new Error('Command timed out'))
    await vi.waitFor(() => expect(existingHandler).toHaveBeenCalledWith('unavailable'))
    expect(newHandler).not.toHaveBeenCalled()
    acknowledgeNew(3)
    await subscription
    connection.client?.emit('message', 'execution:signal:execution-new', 'cancelled')
    expect(newHandler).toHaveBeenCalledExactlyOnceWith('cancelled')
  })

  it('preserves the pending acknowledgement when Redis reconnects before it arrives', async () => {
    const hub = getExecutionSignalHub()
    connection.client?.emit('ready')
    let acknowledge!: (count: number) => void
    mockSubscribe.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        acknowledge = resolve
      })
    )
    const handler = vi.fn()
    const subscription = hub.subscribe('execution-new', handler)
    connection.status = 'reconnecting'
    connection.client?.emit('close')
    connection.status = 'ready'
    connection.client?.emit('ready')

    expect(mockSubscribe).toHaveBeenCalledOnce()
    acknowledge(2)
    await subscription
    expect(handler).not.toHaveBeenCalled()
  })

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

      const timeout = vi.advanceTimersByTimeAsync(SUBSCRIBER_READY_TIMEOUT_MS - 1000).then(() => {
        connection.client?.emit('error', new Error('ECONNREFUSED'))
        return vi.advanceTimersByTimeAsync(1000)
      })
      await Promise.all([rejected, timeout])
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

  it('derives the readiness budget from the exact options the subscriber is built with', () => {
    getExecutionSignalHub()
    const options = connection.options as {
      commandTimeout: number
      retryStrategy: (attempt: number) => number
    }

    // One dead handshake, so the budget states the reconnect delay after
    // attempt 1 as the client's own retryStrategy would return it.
    expect(budgetInputs.value).toEqual({
      commandTimeoutMs: options.commandTimeout,
      retryDelaysMs: [options.retryStrategy(1)],
    })
    // And the wait must outlast at least one full dead attempt, or the retry is decorative.
    expect(SUBSCRIBER_READY_TIMEOUT_MS).toBeGreaterThan(
      2 * options.commandTimeout + options.retryStrategy(1)
    )
  })

  it('warms to true once the subscriber becomes ready', async () => {
    connection.status = 'connecting'
    const warm = warmExecutionSignalHub()

    connection.status = 'ready'
    connection.client?.emit('ready')

    await expect(warm).resolves.toBe(true)
  })

  it('warms to false, not a rejection, when readiness never arrives', async () => {
    vi.useFakeTimers()
    try {
      connection.status = 'connect'
      const warm = warmExecutionSignalHub()

      await vi.advanceTimersByTimeAsync(SUBSCRIBER_READY_TIMEOUT_MS)

      await expect(warm).resolves.toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports not-warm instead of throwing when Redis is misconfigured', async () => {
    // Start-up hooks call this; a throw there would fail the run attempt.
    mockRedisUrl.error = new Error('Cache capability selected Redis but REDIS_URL is missing')

    await expect(warmExecutionSignalHub()).resolves.toBe(false)
  })

  it('is trivially warm when signals are process-local', async () => {
    mockRedisUrl.value = undefined

    await expect(warmExecutionSignalHub()).resolves.toBe(true)
  })

  it('uses a process-local signal hub when Redis is not configured', async () => {
    mockRedisUrl.value = undefined
    const handler = vi.fn()
    await getExecutionSignalHub().subscribe('execution-local', handler)

    publishLocalExecutionSignal('execution-local', 'event')

    expect(handler).toHaveBeenCalledWith('event')
  })
})
