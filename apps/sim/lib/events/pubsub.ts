/**
 * Generic Pub/Sub Channel Factory
 *
 * Creates a single-channel pub/sub adapter backed by Redis (with EventEmitter fallback).
 * Each call creates its own Redis connections — use multiple instances for multiple channels.
 */

import { EventEmitter } from 'events'
import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { env } from '@/lib/core/config/env'

const logger = createLogger('PubSub')

export interface PubSubChannel<T> {
  publish(event: T): void
  subscribe(handler: (event: T) => void): () => void
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

  constructor(
    redisUrl: string,
    private config: PubSubChannelConfig
  ) {
    const commonOpts = {
      keepAlive: 1000,
      connectTimeout: 10000,
      maxRetriesPerRequest: null as unknown as number,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => {
        if (times > 10) return 30000
        return Math.min(times * 500, 5000)
      },
    }

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

    this.sub.subscribe(config.channel, (err) => {
      if (err) {
        logger.error(`Failed to subscribe to ${config.label} channel:`, err)
      } else {
        logger.info(`Subscribed to ${config.label} channel`)
      }
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

  dispose(): void {
    this.disposed = true
    this.handlers.clear()

    const noop = () => {}
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

  dispose(): void {
    this.emitter.removeAllListeners()
    logger.info(`${this.config.label} local pub/sub disposed`)
  }
}

export function createPubSubChannel<T>(config: PubSubChannelConfig): PubSubChannel<T> {
  const redisUrl = env.REDIS_URL

  if (redisUrl) {
    try {
      logger.info(`${config.label}: Using Redis`)
      return new RedisPubSubChannel<T>(redisUrl, config)
    } catch (err) {
      logger.error(`Failed to create Redis ${config.label}, falling back to local:`, err)
      return new LocalPubSubChannel<T>(config)
    }
  }

  return new LocalPubSubChannel<T>(config)
}
