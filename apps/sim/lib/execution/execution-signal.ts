import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { coldConnectionBudgetMs } from '@sim/utils/retry'
import Redis, { type RedisOptions } from 'ioredis'
import { getConfiguredRedisUrl, getRedisConnectionDefaults } from '@/lib/core/config/redis'

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

/** Settles on the subscriber's next `ready` or `end`; `detach` stops listening for either. */
interface ReadySignal {
  promise: Promise<void>
  detach: () => void
}

export interface ExecutionSignalHub {
  subscribe(executionId: string, handler: ExecutionSignalHandler): Promise<() => void>
  /** Resolves `true` once the hub can deliver signals, `false` if that could not be established in time. Never rejects. */
  warm(): Promise<boolean>
}

export function getExecutionSignalChannel(executionId: string): string {
  return `${EXECUTION_SIGNAL_PREFIX}${executionId}`
}

class RedisExecutionSignalHub implements ExecutionSignalHub {
  private readonly subscriber: Redis
  /**
   * How long any one caller waits for readiness: room for one dead attempt and
   * then a healthy one, so ioredis's own reconnect can be what rescues a stalled
   * connection instead of the wait expiring while the first attempt is still
   * being diagnosed. Derived from the exact options the client is built with.
   *
   * Every `subscribe` pays this too, not only warm-up — including against a
   * Redis that is simply unreachable, where the connect deadline is what runs
   * out and nothing is being diagnosed. That is the cost of the recovery.
   */
  private readonly readyTimeoutMs: number
  private readonly handlers = new Map<string, Set<ExecutionSignalHandler>>()
  private readonly subscriptions = new Map<string, ChannelSubscription>()
  private readySignal: ReadySignal | undefined
  private readyWaiters = 0
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

  async warm(): Promise<boolean> {
    try {
      while (this.subscriber.status !== 'ready') {
        await this.waitForConnectionReady()
      }
      return true
    } catch (error) {
      logger.warn(
        'Execution signal subscriber warm-up gave up; first subscribe will pay the handshake',
        {
          error: toError(error).message,
          status: this.subscriber.status,
        }
      )
      return false
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
   * One readiness signal is shared by every waiter so the client carries a
   * single `ready`/`end` listener pair, but each waiter runs its own deadline
   * over it. A shared timer would hand a subscribe that joins an in-flight
   * warm-up only the remainder of that warm-up's budget — down to nothing —
   * where it used to be guaranteed a full wait of its own. The signal is torn
   * down when its last waiter gives up, so a timeout leaves nothing attached.
   */
  private waitForConnectionReady(): Promise<void> {
    if (this.subscriber.status === 'end') {
      return Promise.reject(new Error('Redis subscriber connection ended'))
    }
    const signal = (this.readySignal ??= this.createReadySignal())
    this.readyWaiters++
    return new Promise<void>((resolve, reject) => {
      const leave = () => {
        clearTimeout(timeout)
        if (--this.readyWaiters === 0 && this.readySignal === signal) {
          signal.detach()
          this.readySignal = undefined
        }
      }
      const timeout = setTimeout(() => {
        leave()
        reject(new Error('Timed out waiting for Redis subscriber readiness'))
      }, this.readyTimeoutMs)
      signal.promise.then(
        () => {
          leave()
          resolve()
        },
        (error: unknown) => {
          leave()
          reject(error)
        }
      )
    })
  }

  private createReadySignal(): ReadySignal {
    let detach = () => {}
    const promise = new Promise<void>((resolve, reject) => {
      const onReady = () => {
        detach()
        resolve()
      }
      const onEnd = () => {
        detach()
        reject(new Error('Redis subscriber connection ended'))
      }
      detach = () => {
        this.subscriber.removeListener('ready', onReady)
        this.subscriber.removeListener('end', onEnd)
      }
      this.subscriber.once('ready', onReady)
      this.subscriber.once('end', onEnd)
    })
    // Detached before settling, this promise is simply dropped; an `end` that
    // arrives after every waiter has left must not surface as unhandled.
    promise.catch(() => undefined)
    return { promise, detach }
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

  warm(): Promise<boolean> {
    return Promise.resolve(true)
  }

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
 * Establishes the hub's subscriber connection ahead of a cancellation
 * subscription, so that subscribe does not pay the handshake inside its own
 * readiness budget. Called fire-and-forget at the execution entry point — the
 * one path every execution shares, early enough to overlap the work ahead of
 * the subscribe — and at boot in long-lived servers. Never throws or rejects:
 * a throw from a start-up hook would fail the run, and a cold hub is only
 * slower, not wrong.
 */
export async function warmExecutionSignalHub(): Promise<boolean> {
  let hub: ExecutionSignalHub
  try {
    hub = getExecutionSignalHub()
  } catch {
    return false
  }
  return hub.warm()
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
