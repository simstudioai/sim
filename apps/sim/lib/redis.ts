import Redis from 'ioredis'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Redis')

// Default to localhost if REDIS_URL is not provided
const redisUrl = env.REDIS_URL || 'redis://localhost:6379'

// Global Redis client for connection pooling
// This is important for serverless environments like Vercel
let globalRedisClient: Redis | null = null

// Fallback in-memory cache for when Redis is not available
const inMemoryCache = new Map<string, { value: string; expiry: number | null }>()
const MAX_CACHE_SIZE = 1000

/**
 * Get a Redis client instance
 * Uses connection pooling to avoid creating a new connection for each request
 * This is critical for performance in serverless environments like Vercel
 */
export function getRedisClient(): Redis | null {
  // For server-side only
  if (typeof window !== 'undefined') return null

  if (globalRedisClient) return globalRedisClient

  try {
    // Create a new Redis client with optimized settings for serverless
    globalRedisClient = new Redis(redisUrl, {
      // Keep alive is critical for serverless to reuse connections
      keepAlive: 1000,
      // Faster connection timeout for serverless
      connectTimeout: 5000,
      // Disable reconnection attempts in serverless
      maxRetriesPerRequest: 3,
      // Retry strategy with exponential backoff
      retryStrategy: (times) => {
        if (times > 5) {
          logger.warn('Redis connection failed after 5 attempts, using fallback')
          return null // Stop retrying
        }
        return Math.min(times * 200, 2000) // Exponential backoff
      },
    })

    // Handle connection events
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

// Message ID cache functions
const MESSAGE_ID_PREFIX = 'processed:' // Generic prefix
const MESSAGE_ID_EXPIRY = 60 * 60 * 24 * 7 // 7 days in seconds

/**
 * Check if a key exists in Redis or fallback cache.
 * @param key The key to check (e.g., messageId, lockKey).
 * @returns True if the key exists and hasn't expired, false otherwise.
 */
export async function hasProcessedMessage(key: string): Promise<boolean> {
  try {
    const redis = getRedisClient()
    const fullKey = `${MESSAGE_ID_PREFIX}${key}` // Use generic prefix

    if (redis) {
      // Use Redis if available
      const result = await redis.exists(fullKey)
      return result === 1
    }
    // Fallback to in-memory cache
    const cacheEntry = inMemoryCache.get(fullKey)
    if (!cacheEntry) return false

    // Check if the entry has expired
    if (cacheEntry.expiry && cacheEntry.expiry < Date.now()) {
      inMemoryCache.delete(fullKey)
      return false
    }

    return true
  } catch (error) {
    logger.error(`Error checking key ${key}:`, { error })
    // Fallback to in-memory cache on error
    const fullKey = `${MESSAGE_ID_PREFIX}${key}`
    const cacheEntry = inMemoryCache.get(fullKey)
    return !!cacheEntry && (!cacheEntry.expiry || cacheEntry.expiry > Date.now())
  }
}

/**
 * Mark a key as processed/present in Redis or fallback cache.
 * @param key The key to mark (e.g., messageId, lockKey).
 * @param expirySeconds Optional expiry time in seconds (defaults to 7 days).
 */
export async function markMessageAsProcessed(
  key: string,
  expirySeconds: number = MESSAGE_ID_EXPIRY
): Promise<void> {
  try {
    const redis = getRedisClient()
    const fullKey = `${MESSAGE_ID_PREFIX}${key}` // Use generic prefix

    if (redis) {
      // Use Redis if available - use pipelining for efficiency
      await redis.set(fullKey, '1', 'EX', expirySeconds)
    } else {
      // Fallback to in-memory cache
      const expiry = expirySeconds ? Date.now() + expirySeconds * 1000 : null
      inMemoryCache.set(fullKey, { value: '1', expiry })

      // Clean up old message IDs if cache gets too large
      if (inMemoryCache.size > MAX_CACHE_SIZE) {
        const now = Date.now()

        // First try to remove expired entries
        for (const [cacheKey, entry] of inMemoryCache.entries()) {
          if (entry.expiry && entry.expiry < now) {
            inMemoryCache.delete(cacheKey)
          }
        }

        // If still too large, remove oldest entries (FIFO based on insertion order)
        if (inMemoryCache.size > MAX_CACHE_SIZE) {
          const keysToDelete = Array.from(inMemoryCache.keys()).slice(
            0,
            inMemoryCache.size - MAX_CACHE_SIZE
          )

          for (const keyToDelete of keysToDelete) {
            inMemoryCache.delete(keyToDelete)
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error marking key ${key} as processed:`, { error })
    // Fallback to in-memory cache on error
    const fullKey = `${MESSAGE_ID_PREFIX}${key}`
    const expiry = expirySeconds ? Date.now() + expirySeconds * 1000 : null
    inMemoryCache.set(fullKey, { value: '1', expiry })
  }
}

/**
 * Attempts to acquire a lock using Redis SET NX command.
 * @param lockKey The key to use for the lock.
 * @param value The value to set (e.g., a unique identifier for the process holding the lock).
 * @param expirySeconds The lock's time-to-live in seconds.
 * @returns True if the lock was acquired successfully, false otherwise.
 */
export async function acquireLock(
  lockKey: string,
  value: string,
  expirySeconds: number
): Promise<boolean> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn('Redis client not available, cannot acquire lock.')
      // Fallback behavior: maybe allow processing but log a warning?
      // Or treat as lock acquired if no Redis? Depends on desired behavior.
      return true // Or false, depending on safety requirements
    }

    // Use SET key value EX expirySeconds NX
    // Returns "OK" if successful, null if key already exists (lock held)
    const result = await redis.set(lockKey, value, 'EX', expirySeconds, 'NX')

    return result === 'OK'
  } catch (error) {
    logger.error(`Error acquiring lock for key ${lockKey}:`, { error })
    // Treat errors as failure to acquire lock for safety
    return false
  }
}

/**
 * Retrieves the value of a key from Redis.
 * @param key The key to retrieve.
 * @returns The value of the key, or null if the key doesn't exist or an error occurs.
 */
export async function getLockValue(key: string): Promise<string | null> {
  try {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn('Redis client not available, cannot get lock value.')
      return null // Cannot determine lock value
    }
    return await redis.get(key)
  } catch (error) {
    logger.error(`Error getting value for key ${key}:`, { error })
    return null
  }
}

/**
 * Releases a lock by deleting the key.
 * Ideally, use Lua script for safe release (check value before deleting),
 * but simple DEL is often sufficient if lock expiry is handled well.
 * @param lockKey The key of the lock to release.
 */
export async function releaseLock(lockKey: string): Promise<void> {
  try {
    const redis = getRedisClient()
    if (redis) {
      await redis.del(lockKey)
    } else {
      logger.warn('Redis client not available, cannot release lock.')
      // No fallback needed for releasing if using in-memory cache for locking wasn't implemented
    }
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
