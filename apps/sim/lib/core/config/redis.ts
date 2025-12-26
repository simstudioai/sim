import { createLogger } from '@sim/logger'
import Redis from 'ioredis'
import { env } from '@/lib/core/config/env'

const logger = createLogger('Redis')

const redisUrl = env.REDIS_URL

let globalRedisClient: Redis | null = null

/**
 * Get a Redis client instance.
 * Uses connection pooling to reuse connections across requests.
 *
 * ioredis handles command queuing internally via `enableOfflineQueue` (default: true),
 * so commands are queued and executed once connected. No manual connection checks needed.
 */
export function getRedisClient(): Redis | null {
  if (typeof window !== 'undefined') return null
  if (!redisUrl) return null
  if (globalRedisClient) return globalRedisClient

  try {
    logger.info('Initializing Redis client')

    globalRedisClient = new Redis(redisUrl, {
      keepAlive: 1000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 5,
      enableOfflineQueue: true,

      retryStrategy: (times) => {
        if (times > 10) {
          logger.error(`Redis reconnection attempt ${times}`, { nextRetryMs: 30000 })
          return 30000
        }
        const delay = Math.min(times * 500, 5000)
        logger.warn(`Redis reconnecting`, { attempt: times, nextRetryMs: delay })
        return delay
      },

      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']
        return targetErrors.some((e) => err.message.includes(e))
      },
    })

    globalRedisClient.on('connect', () => logger.info('Redis connected'))
    globalRedisClient.on('ready', () => logger.info('Redis ready'))
    globalRedisClient.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message, code: (err as any).code })
    })
    globalRedisClient.on('close', () => logger.warn('Redis connection closed'))
    globalRedisClient.on('end', () => logger.error('Redis connection ended'))

    return globalRedisClient
  } catch (error) {
    logger.error('Failed to initialize Redis client', { error })
    return null
  }
}

/**
 * Check if Redis is ready for commands.
 * Use for health checks only - commands should be sent regardless (ioredis queues them).
 */
export function isRedisConnected(): boolean {
  return globalRedisClient?.status === 'ready'
}

/**
 * Get Redis connection status for diagnostics.
 */
export function getRedisStatus(): string {
  return globalRedisClient?.status ?? 'not initialized'
}

const MESSAGE_ID_PREFIX = 'processed:'
const MESSAGE_ID_EXPIRY = 60 * 60 * 24 * 7

/**
 * Check if a message has been processed (for idempotency).
 * Requires Redis - throws if Redis is not available.
 */
export async function hasProcessedMessage(key: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available for message deduplication')
  }

  const result = await redis.exists(`${MESSAGE_ID_PREFIX}${key}`)
  return result === 1
}

/**
 * Mark a message as processed (for idempotency).
 * Requires Redis - throws if Redis is not available.
 */
export async function markMessageAsProcessed(
  key: string,
  expirySeconds: number = MESSAGE_ID_EXPIRY
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available for message deduplication')
  }

  await redis.set(`${MESSAGE_ID_PREFIX}${key}`, '1', 'EX', expirySeconds)
}

/**
 * Lua script for safe lock release.
 * Only deletes the key if the value matches (ownership verification).
 * Returns 1 if deleted, 0 if not (value mismatch or key doesn't exist).
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Acquire a distributed lock using Redis SET NX.
 * Returns true if lock acquired, false if already held.
 * Requires Redis - throws if Redis is not available.
 */
export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available for distributed locking')
  }

  const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
  return result === 'OK'
}

/**
 * Get the value of a lock key.
 * Requires Redis - throws if Redis is not available.
 */
export async function getLockValue(key: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available')
  }

  return redis.get(key)
}

/**
 * Release a distributed lock safely.
 * Only releases if the caller owns the lock (value matches).
 * Returns true if lock was released, false if not owned or already expired.
 * Requires Redis - throws if Redis is not available.
 */
export async function releaseLock(lockKey: string, value: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis not available for distributed locking')
  }

  const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, value)
  return result === 1
}

/**
 * Close the Redis connection.
 * Use for graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (globalRedisClient) {
    try {
      await globalRedisClient.quit()
    } catch (error) {
      logger.error('Error closing Redis connection', { error })
    } finally {
      globalRedisClient = null
    }
  }
}
