import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import Redis, { type RedisOptions } from 'ioredis'
import { getConfiguredRedisUrl, getRedisConnectionDefaults } from '@/lib/core/config/redis'
import { coldConnectionBudgetMs } from '@/lib/core/config/redis-budget'

const logger = createLogger('ExecutionSignalHub')
const EXECUTION_SIGNAL_PREFIX = 'execution:signal:'
/**
 * Bounds the live `SUBSCRIBE` as well as the handshake commands — ioredis has
 * one deadline for both — and an initial subscribe that rejects fails the run,
 * so this stays at the tolerance a ready-but-slow server has always been
 * given rather than being tightened to diagnose dead handshakes faster.
 */
const SUBSCRIBER_COMMAND_TIMEOUT_MS = 5_000
const subscriberRetryDelayMs = (attempt: number): number => Math.min(attempt * 500, 5000)
export const LEGACY_EXECUTION_CANCEL_CHANNEL = 'execution:cancel'

export type ExecutionSignalReason = 'event' | 'cancelled' | 'reconnected' | 'unavailable'
export type ExecutionSignalHandler = (reason: ExecutionSignalReason) => void

interface ChannelSubscription {
  ready: Promise<void>
  acknowledged: boolean
}

/**
 * Settles on the subscriber's next `ready` or `end`. Shared by every waiter so
 * the client carries a single listener pair; `waiters` counts them so the last
 * one to leave can `detach` the listeners.
 */
interface ReadySignal {
  promise: Promise<void>
  detach: () => void
  waiters: number
}

export interface ExecutionSignalHub {
  subscribe(executionId: string, handler: ExecutionSignalHandler): Promise<() => void>
}

export function getExecutionSignalChannel(executionId: string): string {
  return `${EXECUTION_SIGNAL_PREFIX}${executionId}`
}

class RedisExecutionSignalHub implements ExecutionSignalHub {
  private readonly subscriber: Redis
  /**
   * How long any one subscribe waits for readiness: room for one dead attempt
   * and then a healthy one, so ioredis's own reconnect can be what rescues a
   * stalled connection instead of the wait expiring while the first attempt is
   * still being diagnosed. Derived from the exact options the client is built
   * with. It is paid against a Redis that is simply unreachable as well, where
   * the connect deadline is what runs out and nothing is being diagnosed; that
   * is the cost of the recovery, and it widens the window in which a short
   * execution timeout can pre-empt the wait and report itself instead.
   */
  private readonly readyTimeoutMs: number
  private readonly handlers = new Map<string, Set<ExecutionSignalHandler>>()
  private readonly subscriptions = new Map<string, ChannelSubscription>()
  private readySignal: ReadySignal | undefined
  private connectedOnce = false

  constructor(redisUrl: string) {
    const options = {
      ...getRedisConnectionDefaults(redisUrl),
      commandTimeout: SUBSCRIBER_COMMAND_TIMEOUT_MS,
      connectionName: 'execution-signal-hub',
      maxRetriesPerRequest: null,
      retryStrategy: subscriberRetryDelayMs,
    } satisfies RedisOptions
    this.readyTimeoutMs = coldConnectionBudgetMs({
      connectTimeoutMs: options.connectTimeout,
      commandTimeoutMs: options.commandTimeout,
      disconnectTimeoutMs: options.disconnectTimeout,
      reconnectDelayMs: subscriberRetryDelayMs(1),
    })
    this.subscriber = new Redis(redisUrl, options)
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === LEGACY_EXECUTION_CANCEL_CHANNEL) {
        try {
          const event: unknown = JSON.parse(message)
          if (isRecordLike(event) && typeof event.executionId === 'string') {
            if (event.executionSignalPublished === true) return
            this.dispatch(getExecutionSignalChannel(event.executionId), 'cancelled')
          }
        } catch (error) {
          logger.warn('Ignored malformed legacy execution cancellation signal', {
            error: toError(error).message,
          })
        }
        return
      }
      this.dispatch(channel, message === 'cancelled' ? 'cancelled' : 'event')
    })
    this.subscriber.on('ready', () => {
      void this.handleReady()
    })
    this.subscriber.on('error', (error: Error) => {
      logger.error('Execution signal subscriber error', { error: error.message })
    })
  }

  async subscribe(executionId: string, handler: ExecutionSignalHandler): Promise<() => void> {
    const channel = getExecutionSignalChannel(executionId)
    let channelHandlers = this.handlers.get(channel)
    if (!channelHandlers) {
      channelHandlers = new Set()
      this.handlers.set(channel, channelHandlers)
    }
    channelHandlers.add(handler)

    let subscription = this.subscriptions.get(channel)
    if (!subscription) {
      subscription = this.createSubscription([channel])
      this.subscriptions.set(channel, subscription)
    }
    try {
      await subscription.ready
    } catch (error) {
      if (this.subscriptions.get(channel) === subscription) {
        this.subscriptions.delete(channel)
      }
      channelHandlers.delete(handler)
      if (channelHandlers.size === 0) this.handlers.delete(channel)
      throw new Error(`Execution signal subscription failed: ${toError(error).message}`, {
        cause: error,
      })
    }

    return () => {
      const current = this.handlers.get(channel)
      if (!current) return
      current.delete(handler)
      if (current.size > 0) return
      this.handlers.delete(channel)
      this.subscriptions.delete(channel)
      void this.subscriber.unsubscribe(channel).catch((error) => {
        logger.warn('Execution signal unsubscribe failed', {
          channel,
          error: toError(error).message,
        })
      })
    }
  }

  private createSubscription(channels: string[]): ChannelSubscription {
    const subscription: ChannelSubscription = {
      acknowledged: false,
      ready: this.subscribeChannels(...channels, LEGACY_EXECUTION_CANCEL_CHANNEL).then(() => {
        subscription.acknowledged = true
      }),
    }
    return subscription
  }

  /**
   * ioredis can send SUBSCRIBE during its handshake because Redis permits it
   * while loading. Wait until the handshake's INFO completes before entering
   * subscriber mode, including when new executions arrive during reconnect.
   */
  private async subscribeChannels(...channels: string[]): Promise<void> {
    while (this.subscriber.status !== 'ready') {
      await this.waitForConnectionReady()
    }
    await this.subscriber.subscribe(...channels)
  }

  /**
   * Each waiter runs its own deadline over the shared readiness signal. One
   * shared timer — which is what the memoized promise had — hands a waiter that
   * joins late only the remainder of the first waiter's budget, down to
   * nothing. The last waiter to leave detaches the signal, so a timeout leaves
   * nothing attached; a signal that settles clears itself, so a later waiter
   * observes the connection afresh rather than a readiness that has passed.
   */
  private waitForConnectionReady(): Promise<void> {
    if (this.subscriber.status === 'end') {
      return Promise.reject(new Error('Redis subscriber connection ended'))
    }
    const signal = (this.readySignal ??= this.createReadySignal())
    signal.waiters++
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Timed out waiting for Redis subscriber readiness')),
        this.readyTimeoutMs
      )
    })
    return Promise.race([signal.promise, deadline]).finally(() => {
      clearTimeout(timer)
      if (--signal.waiters === 0) {
        signal.detach()
        if (this.readySignal === signal) this.readySignal = undefined
      }
    })
  }

  /**
   * The promise is deliberately marked handled: a waiter that gives up stops
   * observing it, and an `end` that arrives after the last one has left must
   * not surface as an unhandled rejection.
   */
  private createReadySignal(): ReadySignal {
    const signal: ReadySignal = { promise: Promise.resolve(), detach: () => undefined, waiters: 0 }
    signal.promise = new Promise<void>((resolve, reject) => {
      const settle = () => {
        signal.detach()
        if (this.readySignal === signal) this.readySignal = undefined
      }
      const onReady = () => {
        settle()
        resolve()
      }
      const onEnd = () => {
        settle()
        reject(new Error('Redis subscriber connection ended'))
      }
      signal.detach = () => {
        this.subscriber.removeListener('ready', onReady)
        this.subscriber.removeListener('end', onEnd)
      }
      this.subscriber.once('ready', onReady)
      this.subscriber.once('end', onEnd)
    })
    signal.promise.catch(() => undefined)
    return signal
  }

  private async handleReady(): Promise<void> {
    const reconnect = this.connectedOnce
    this.connectedOnce = true
    if (!reconnect || this.handlers.size === 0) return

    const channels = [...this.handlers.keys()].filter(
      (channel) => this.subscriptions.get(channel)?.acknowledged
    )
    if (channels.length === 0) return
    const subscription = this.createSubscription(channels)
    for (const channel of channels) {
      if (this.handlers.has(channel)) this.subscriptions.set(channel, subscription)
    }
    try {
      await subscription.ready
      for (const channel of channels) {
        if (this.handlers.has(channel) && this.subscriptions.get(channel) === subscription) {
          this.dispatch(channel, 'reconnected')
        } else if (!this.handlers.has(channel)) {
          void this.subscriber.unsubscribe(channel)
        }
      }
    } catch (error) {
      logger.error('Execution signal resubscription failed', { error: toError(error).message })
      for (const channel of channels) {
        if (this.subscriptions.get(channel) !== subscription) continue
        this.subscriptions.delete(channel)
        this.dispatch(channel, 'unavailable')
      }
    }
  }

  private dispatch(channel: string, reason: ExecutionSignalReason): void {
    const channelHandlers = this.handlers.get(channel)
    if (!channelHandlers) return
    for (const handler of channelHandlers) {
      try {
        handler(reason)
      } catch (error) {
        logger.error('Execution signal handler failed', { error: toError(error).message })
      }
    }
  }
}

class LocalExecutionSignalHub implements ExecutionSignalHub {
  private readonly handlers = new Map<string, Set<ExecutionSignalHandler>>()

  async subscribe(executionId: string, handler: ExecutionSignalHandler): Promise<() => void> {
    const channel = getExecutionSignalChannel(executionId)
    let channelHandlers = this.handlers.get(channel)
    if (!channelHandlers) {
      channelHandlers = new Set()
      this.handlers.set(channel, channelHandlers)
    }
    channelHandlers.add(handler)
    return () => {
      const current = this.handlers.get(channel)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) this.handlers.delete(channel)
    }
  }

  publish(
    executionId: string,
    reason: Extract<ExecutionSignalReason, 'event' | 'cancelled'>
  ): void {
    const channelHandlers = this.handlers.get(getExecutionSignalChannel(executionId))
    if (!channelHandlers) return
    for (const handler of channelHandlers) {
      try {
        handler(reason)
      } catch (error) {
        logger.error('Local execution signal handler failed', { error: toError(error).message })
      }
    }
  }
}

type ExecutionSignalGlobal = typeof globalThis & {
  _executionSignalHub?: ExecutionSignalHub
}

const executionSignalGlobal = globalThis as ExecutionSignalGlobal

export function getExecutionSignalHub(): ExecutionSignalHub {
  if (executionSignalGlobal._executionSignalHub) return executionSignalGlobal._executionSignalHub
  const redisUrl = getConfiguredRedisUrl()
  if (!redisUrl) {
    executionSignalGlobal._executionSignalHub = new LocalExecutionSignalHub()
    return executionSignalGlobal._executionSignalHub
  }
  executionSignalGlobal._executionSignalHub = new RedisExecutionSignalHub(redisUrl)
  return executionSignalGlobal._executionSignalHub
}

/**
 * Begins the hub's subscriber connection ahead of a cancellation subscription,
 * so that subscribe does not pay the handshake inside its own readiness
 * budget. Constructing the hub is what connects — ioredis dials in its
 * constructor — so there is nothing to await. Called at the execution entry
 * point, the one path every execution shares, early enough to overlap the work
 * ahead of the subscribe. Never throws: a misconfigured URL belongs to the
 * first real subscriber, which reports it against the execution that needed
 * signals, and a cold hub is only slower, not wrong.
 */
export function connectExecutionSignalHub(): void {
  try {
    getExecutionSignalHub()
  } catch {
    return
  }
}

export function publishLocalExecutionSignal(
  executionId: string,
  reason: Extract<ExecutionSignalReason, 'event' | 'cancelled'>
): void {
  const hub = getExecutionSignalHub()
  if (!(hub instanceof LocalExecutionSignalHub)) {
    throw new Error('Local execution signals are unavailable while Redis is configured')
  }
  hub.publish(executionId, reason)
}
