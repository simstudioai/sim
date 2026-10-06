/**
 * Generic Pub/Sub Channel Factory
 *
 * Creates a single-channel pub/sub adapter backed by Redis (with EventEmitter fallback).
 * Each call creates its own Redis connections — use multiple instances for multiple channels.
 */

import { EventEmitter } from 'events'
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
   * then reaches no subscriber here.
   */
  ready(): Promise<void>
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
  private disposed = false
  /** Whether the current connection has subscribed; a dropped connection has to again. */
  private listening = false
  private subscribed: Promise<void> = Promise.resolve()
  private markSubscribed: () => void = noop

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
    // does not report when that lands, and SUBSCRIBE is idempotent. Readiness settles on failure
    // too: nothing retries a failed subscribe, so waiting on it would only hold back every stream
    // on this channel.
    this.sub.on('ready', () => {
      this.sub.subscribe(config.channel, (err) => {
        if (err) {
          logger.error(`Failed to subscribe to ${config.label} channel:`, err)
        } else {
          this.listening = true
          logger.info(`Subscribed to ${config.label} channel`)
        }
        this.markSubscribed()
      })
    })
    this.sub.on('close', () => {
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
    if (this.disposed) return
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

  private awaitSubscription(): void {
    this.subscribed = new Promise((resolve) => {
      this.markSubscribed = resolve
    })
  }

  dispose(): void {
    this.disposed = true
    this.handlers.clear()

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

class LocalPubSubChannel<T> implements PubSubChannel<T> {
  private emitter = new EventEmitter()

  constructor(private config: PubSubChannelConfig) {
    this.emitter.setMaxListeners(100)
    logger.info(`${config.label}: Using process-local EventEmitter (Redis not configured)`)
  }

  publish(event: T): void {
    this.emitter.emit(this.config.channel, event)
  }

  subscribe(handler: (event: T) => void): () => void {
    this.emitter.on(this.config.channel, handler)
    return () => {
      this.emitter.off(this.config.channel, handler)
    }
  }

  ready(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): void {
    this.emitter.removeAllListeners()
    logger.info(`${this.config.label} local pub/sub disposed`)
  }
}

export function createPubSubChannel<T>(config: PubSubChannelConfig): PubSubChannel<T> {
  const redisUrl = getConfiguredRedisUrl()
  if (!redisUrl) return new LocalPubSubChannel<T>(config)

  // Resolve config-derived defaults outside the try so a missing
  // REDIS_TLS_SERVERNAME (config error) surfaces instead of silently degrading
  // to the in-process EventEmitter — that would break cross-replica pub/sub.
  const connectionDefaults = getRedisConnectionDefaults(redisUrl)

  logger.info(`${config.label}: Using Redis`)
  return new RedisPubSubChannel<T>(redisUrl, connectionDefaults, config)
}
