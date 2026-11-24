/**
 * Generic Pub/Sub Channel Factory
 *
 * Creates a single-channel pub/sub adapter backed by Redis. Each channel opens its own pair of
 * Redis connections, and only on first use, so a module may build its channel at import time
 * (including during `next build`, where no REDIS_URL is set) without connecting or throwing.
 */

import { createLogger } from '@sim/logger'
import { noop } from '@sim/utils/helpers'
import Redis, { type RedisOptions } from 'ioredis'
import { getConfiguredRedisUrl, getRedisConnectionDefaults } from '@/lib/core/config/redis'

const logger = createLogger('PubSub')

export interface PubSubChannel<T> {
  publish(event: T): void
  subscribe(handler: (event: T) => void): () => void
  /**
   * Settles once this process receives the channel's publications; anything published before
   * then reaches no subscriber here. Stays pending while the channel cannot subscribe, so a caller
   * that must not wait indefinitely bounds the wait.
   */
  ready(): Promise<void>
  /** Whether this process receives the channel's publications right now. */
  isReady(): boolean
  /**
   * Calls `listener` once this process next receives the channel's publications (at once if it
   * already does). The returned function drops a listener that has not fired, so a caller that
   * gives up while the channel cannot subscribe retains nothing.
   */
  onReady(listener: () => void): () => void
  dispose(): void
}

interface PubSubChannelConfig {
  channel: string
  label: string
}

class RedisPubSubChannel<T> implements PubSubChannel<T> {
  private pub: Redis
  private sub: Redis
  private handlers = new Set<(event: T) => void>()
  /** Whether the current connection has subscribed; a dropped connection has to again. */
  private listening = false
  /** Counts closed connections, so a subscribe answered after its connection closed is ignored. */
  private closedConnections = 0
  private subscribed: Promise<void> = Promise.resolve()
  private markSubscribed: () => void = noop
  private readyListeners = new Set<() => void>()

  constructor(
    redisUrl: string,
    connectionDefaults: ReturnType<typeof getRedisConnectionDefaults>,
    private config: PubSubChannelConfig
  ) {
    const commonOpts = {
      ...connectionDefaults,
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => {
        if (times > 10) return 30000
        return Math.min(times * 500, 5000)
      },
    } satisfies RedisOptions

    this.pub = new Redis(redisUrl, { ...commonOpts, connectionName: `${config.label}-pub` })
    this.sub = new Redis(redisUrl, { ...commonOpts, connectionName: `${config.label}-sub` })

    this.pub.on('error', (err) =>
      logger.error(`${config.label} publish client error:`, err.message)
    )
    this.sub.on('error', (err) =>
      logger.error(`${config.label} subscribe client error:`, err.message)
    )
    this.pub.on('connect', () => logger.info(`${config.label} publish client connected`))
    this.sub.on('connect', () => logger.info(`${config.label} subscribe client connected`))

    this.awaitSubscription()
    // Subscribes on every ready connection: ioredis resubscribes after a reconnect on its own but
    // does not report when that lands, and SUBSCRIBE is idempotent. A failed subscribe leaves the
    // channel not ready; the next connection tries again.
    this.sub.on('ready', () => {
      const connection = this.closedConnections
      this.sub.subscribe(config.channel, (err) => {
        if (connection !== this.closedConnections) return
        if (err) {
          logger.error(`Failed to subscribe to ${config.label} channel:`, err)
          return
        }
        this.listening = true
        logger.info(`Subscribed to ${config.label} channel`)
        this.markSubscribed()
        const listeners = [...this.readyListeners]
        this.readyListeners.clear()
        for (const listener of listeners) {
          try {
            listener()
          } catch (err) {
            logger.error(`Error in ${config.label} ready listener:`, err)
          }
        }
      })
    })
    this.sub.on('close', () => {
      this.closedConnections += 1
      if (!this.listening) return
      this.listening = false
      this.awaitSubscription()
    })

    this.sub.on('message', (channel: string, message: string) => {
      if (channel !== config.channel) return
      try {
        const parsed = JSON.parse(message) as T
        for (const handler of this.handlers) {
          try {
            handler(parsed)
          } catch (err) {
            logger.error(`Error in ${config.label} handler:`, err)
          }
        }
      } catch (err) {
        logger.error(`Failed to parse ${config.label} message:`, err)
      }
    })
  }

  publish(event: T): void {
    this.pub.publish(this.config.channel, JSON.stringify(event)).catch((err) => {
      logger.error(`Failed to publish to ${this.config.label}:`, err)
    })
  }

  subscribe(handler: (event: T) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  ready(): Promise<void> {
    return this.subscribed
  }

  isReady(): boolean {
    return this.listening
  }

  onReady(listener: () => void): () => void {
    if (this.listening) {
      listener()
      return noop
    }
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }

  private awaitSubscription(): void {
    this.subscribed = new Promise((resolve) => {
      this.markSubscribed = resolve
    })
  }

  dispose(): void {
    this.handlers.clear()
    this.readyListeners.clear()

    this.pub.removeAllListeners()
    this.sub.removeAllListeners()
    this.pub.on('error', noop)
    this.sub.on('error', noop)

    this.sub.unsubscribe().catch(noop)
    this.pub.quit().catch(noop)
    this.sub.quit().catch(noop)
    logger.info(`${this.config.label} Redis pub/sub disposed`)
  }
}

/**
 * Builds a channel whose Redis connections open on its first `publish`, `subscribe`, or readiness
 * call.
 * A missing or invalid REDIS_URL surfaces from that first call, never from construction. A
 * disposed channel publishes nothing, adds no handlers or ready listeners, and never becomes ready.
 */
export function createPubSubChannel<T>(config: PubSubChannelConfig): PubSubChannel<T> {
  let connection: RedisPubSubChannel<T> | null = null
  let disposed = false

  const open = (): RedisPubSubChannel<T> => {
    if (connection) return connection
    const redisUrl = getConfiguredRedisUrl()
    connection = new RedisPubSubChannel<T>(redisUrl, getRedisConnectionDefaults(redisUrl), config)
    return connection
  }

  return {
    publish(event) {
      if (disposed) return
      open().publish(event)
    },
    subscribe(handler) {
      if (disposed) return noop
      return open().subscribe(handler)
    },
    ready() {
      if (disposed) return new Promise<void>(noop)
      return open().ready()
    },
    isReady() {
      if (disposed) return false
      return open().isReady()
    },
    onReady(listener) {
      if (disposed) return noop
      return open().onReady(listener)
    },
    dispose() {
      disposed = true
      connection?.dispose()
      connection = null
    },
  }
}
