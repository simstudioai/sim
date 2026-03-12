/**
 * Task Status Pub/Sub Adapter
 *
 * Broadcasts task status events across processes using Redis Pub/Sub.
 * Gracefully falls back to process-local EventEmitter when Redis is unavailable.
 *
 * Channel: `task:status_changed`
 */

import { EventEmitter } from 'events'
import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { env } from '@/lib/core/config/env'

const logger = createLogger('TaskPubSub')

const CHANNEL_STATUS_CHANGED = 'task:status_changed'

export interface TaskStatusEvent {
  workspaceId: string
  chatId: string
  type: 'started' | 'completed' | 'created' | 'deleted' | 'renamed'
}

type StatusChangedHandler = (event: TaskStatusEvent) => void

interface TaskPubSubAdapter {
  publishStatusChanged(event: TaskStatusEvent): void
  onStatusChanged(handler: StatusChangedHandler): () => void
  dispose(): void
}

/**
 * Redis-backed pub/sub adapter.
 * Uses dedicated pub and sub clients (ioredis requires separate connections for subscribers).
 */
class RedisTaskPubSub implements TaskPubSubAdapter {
  private pub: Redis
  private sub: Redis
  private handlers = new Set<StatusChangedHandler>()
  private disposed = false

  constructor(redisUrl: string) {
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

    this.pub = new Redis(redisUrl, { ...commonOpts, connectionName: 'task-pubsub-pub' })
    this.sub = new Redis(redisUrl, { ...commonOpts, connectionName: 'task-pubsub-sub' })

    this.pub.on('error', (err) => logger.error('Task pub/sub publish client error:', err.message))
    this.sub.on('error', (err) => logger.error('Task pub/sub subscribe client error:', err.message))
    this.pub.on('connect', () => logger.info('Task pub/sub publish client connected'))
    this.sub.on('connect', () => logger.info('Task pub/sub subscribe client connected'))

    this.sub.subscribe(CHANNEL_STATUS_CHANGED, (err) => {
      if (err) {
        logger.error('Failed to subscribe to task pub/sub channel:', err)
      } else {
        logger.info('Subscribed to task pub/sub channel')
      }
    })

    this.sub.on('message', (channel: string, message: string) => {
      if (channel !== CHANNEL_STATUS_CHANGED) return
      try {
        const parsed = JSON.parse(message) as TaskStatusEvent
        for (const handler of this.handlers) {
          try {
            handler(parsed)
          } catch (err) {
            logger.error('Error in status_changed handler:', err)
          }
        }
      } catch (err) {
        logger.error('Failed to parse task pub/sub message:', err)
      }
    })
  }

  publishStatusChanged(event: TaskStatusEvent): void {
    if (this.disposed) return
    this.pub.publish(CHANNEL_STATUS_CHANGED, JSON.stringify(event)).catch((err) => {
      logger.error('Failed to publish task status_changed:', err)
    })
  }

  onStatusChanged(handler: StatusChangedHandler): () => void {
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
    logger.info('Redis task pub/sub disposed')
  }
}

/**
 * Process-local fallback using EventEmitter.
 * Used when Redis is not configured — notifications only reach listeners in the same process.
 */
class LocalTaskPubSub implements TaskPubSubAdapter {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(100)
    logger.info('Task pub/sub: Using process-local EventEmitter (Redis not configured)')
  }

  publishStatusChanged(event: TaskStatusEvent): void {
    this.emitter.emit(CHANNEL_STATUS_CHANGED, event)
  }

  onStatusChanged(handler: StatusChangedHandler): () => void {
    this.emitter.on(CHANNEL_STATUS_CHANGED, handler)
    return () => {
      this.emitter.off(CHANNEL_STATUS_CHANGED, handler)
    }
  }

  dispose(): void {
    this.emitter.removeAllListeners()
    logger.info('Local task pub/sub disposed')
  }
}

/**
 * Create the appropriate pub/sub adapter based on Redis availability.
 */
function createTaskPubSub(): TaskPubSubAdapter {
  const redisUrl = env.REDIS_URL

  if (redisUrl) {
    try {
      logger.info('Task pub/sub: Using Redis')
      return new RedisTaskPubSub(redisUrl)
    } catch (err) {
      logger.error('Failed to create Redis task pub/sub, falling back to local:', err)
      return new LocalTaskPubSub()
    }
  }

  return new LocalTaskPubSub()
}

export const taskPubSub: TaskPubSubAdapter =
  typeof window !== 'undefined' ? (null as unknown as TaskPubSubAdapter) : createTaskPubSub()
