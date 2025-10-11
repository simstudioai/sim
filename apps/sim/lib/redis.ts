import Redis from 'ioredis'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('Redis')

const redisUrl = env.REDIS_URL
let globalRedisClient: Redis | null = null

const MESSAGE_ID_PREFIX = 'processed:'
const MESSAGE_ID_EXPIRY = 60 * 60 * 24 * 7

/**
 * Get a Redis client instance
 * Uses connection pooling to avoid creating a new connection for each request
 */
export function getRedisClient(): Redis | null {
  if (typeof window !== 'undefined') return null

  if (!redisUrl) {
    return null
  }

  if (globalRedisClient) return globalRedisClient

  try {
    globalRedisClient = new Redis(redisUrl, {
      keepAlive: 1000,
      connectTimeout: 5000,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis connection failed after 5 attempts')
          return null
        }
        return Math.min(times * 200, 2000)
      },
    })

    globalRedisClient.on('error', (err: any) => {
      logger.error('Redis connection error:', { err })
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        globalRedisClient = null
      }
    })

    globalRedisClient.on('connect', () => {})

    return globalRedisClient
  } catch (error) {
    logger.error('Failed to initialize Redis client:', { error })
    return null
  }
}

/**
 * Check if a key exists in Redis
 * @param key The key to check
 * @returns True if the key exists, false otherwise
 */
export async function hasProcessedMessage(key: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    return false
  }

  try {
    const fullKey = `${MESSAGE_ID_PREFIX}${key}`
    const result = await redis.exists(fullKey)
    return result === 1
  } catch (error) {
    logger.error(`Error checking key ${key}:`, { error })
    return false
  }
}

/**
 * Mark a key as processed in Redis
 * @param key The key to mark
 * @param expirySeconds Optional expiry time in seconds (defaults to 7 days)
 */
export async function markMessageAsProcessed(
  key: string,
  expirySeconds: number = MESSAGE_ID_EXPIRY
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn(`Cannot mark message as processed - Redis unavailable: ${key}`)
    return
  }

  try {
    const fullKey = `${MESSAGE_ID_PREFIX}${key}`
    await redis.set(fullKey, '1', 'EX', expirySeconds)
  } catch (error) {
    logger.error(`Error marking key ${key} as processed:`, { error })
  }
}

/**
 * Attempt to acquire a distributed lock using Redis SET NX command
 * @param lockKey The key to use for the lock
 * @param value The value to set (e.g., a unique identifier for the process holding the lock)
 * @param expirySeconds The lock's time-to-live in seconds
 * @returns True if the lock was acquired successfully, false otherwise
 */
export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis client not available, cannot acquire lock.')
    return false
  }

  try {
    const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')
    return result === 'OK'
  } catch (error) {
    logger.error(`Error acquiring lock for key ${lockKey}:`, { error })
    return false
  }
}

/**
 * Retrieve the value of a key from Redis
 * @param key The key to retrieve
 * @returns The value of the key, or null if the key doesn't exist or an error occurs
 */
export async function getLockValue(key: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis client not available, cannot get lock value.')
    return null
  }

  try {
    return await redis.get(key)
  } catch (error) {
    logger.error(`Error getting value for key ${key}:`, { error })
    return null
  }
}

/**
 * Release a lock by deleting the key
 * @param lockKey The key of the lock to release
 */
export async function releaseLock(lockKey: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    logger.warn('Redis client not available, cannot release lock.')
    return
  }

  try {
    await redis.del(lockKey)
  } catch (error) {
    logger.error(`Error releasing lock for key ${lockKey}:`, { error })
  }
}

/**
 * Close the Redis connection
 * Important for proper cleanup in serverless environments
 */
export async function closeRedisConnection(): Promise<void> {
  if (globalRedisClient) {
    try {
      await globalRedisClient.quit()
    } catch (error) {
      logger.error('Error closing Redis connection:', { error })
    } finally {
      globalRedisClient = null
    }
  }
}
