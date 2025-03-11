import Redis from 'ioredis'

// Default to localhost if REDIS_URL is not provided
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

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
          console.warn('Redis connection failed after 5 attempts, using fallback')
          return null // Stop retrying
        }
        return Math.min(times * 200, 2000) // Exponential backoff
      },
    })

    // Handle connection events
    globalRedisClient.on('error', (err: any) => {
      console.error('Redis connection error:', err)
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        globalRedisClient = null
      }
    })

    globalRedisClient.on('connect', () => {
      console.log('Connected to Redis')
    })

    return globalRedisClient
  } catch (error) {
    console.error('Failed to initialize Redis client:', error)
    return null
  }
}

// Message ID cache functions
const MESSAGE_ID_PREFIX = 'whatsapp:message:'
const MESSAGE_ID_EXPIRY = 60 * 60 * 24 * 7 // 7 days in seconds

/**
 * Check if a message ID has been processed before
 * @param messageId The message ID to check
 * @returns True if the message has been processed before, false otherwise
 */
export async function hasProcessedMessage(messageId: string): Promise<boolean> {
  try {
    const redis = getRedisClient()

    if (redis) {
      // Use Redis if available
      const key = `${MESSAGE_ID_PREFIX}${messageId}`
      const result = await redis.exists(key)
      return result === 1
    } else {
      // Fallback to in-memory cache
      const cacheEntry = inMemoryCache.get(messageId)
      if (!cacheEntry) return false

      // Check if the entry has expired
      if (cacheEntry.expiry && cacheEntry.expiry < Date.now()) {
        inMemoryCache.delete(messageId)
        return false
      }

      return true
    }
  } catch (error) {
    console.error('Error checking message ID:', error)
    // Fallback to in-memory cache on error
    const cacheEntry = inMemoryCache.get(messageId)
    return !!cacheEntry && (!cacheEntry.expiry || cacheEntry.expiry > Date.now())
  }
}

/**
 * Mark a message ID as processed
 * @param messageId The message ID to mark as processed
 * @param expirySeconds Optional expiry time in seconds (defaults to 7 days)
 */
export async function markMessageAsProcessed(
  messageId: string,
  expirySeconds: number = MESSAGE_ID_EXPIRY
): Promise<void> {
  try {
    const redis = getRedisClient()

    if (redis) {
      // Use Redis if available - use pipelining for efficiency
      const key = `${MESSAGE_ID_PREFIX}${messageId}`
      await redis.set(key, '1', 'EX', expirySeconds)
    } else {
      // Fallback to in-memory cache
      const expiry = expirySeconds ? Date.now() + expirySeconds * 1000 : null
      inMemoryCache.set(messageId, { value: '1', expiry })

      // Clean up old message IDs if cache gets too large
      if (inMemoryCache.size > MAX_CACHE_SIZE) {
        const now = Date.now()

        // First try to remove expired entries
        for (const [key, entry] of inMemoryCache.entries()) {
          if (entry.expiry && entry.expiry < now) {
            inMemoryCache.delete(key)
          }
        }

        // If still too large, remove oldest entries
        if (inMemoryCache.size > MAX_CACHE_SIZE) {
          const keysToDelete = Array.from(inMemoryCache.keys()).slice(
            0,
            inMemoryCache.size - MAX_CACHE_SIZE
          )

          for (const key of keysToDelete) {
            inMemoryCache.delete(key)
          }
        }
      }
    }
  } catch (error) {
    console.error('Error marking message as processed:', error)
    // Fallback to in-memory cache on error
    const expiry = expirySeconds ? Date.now() + expirySeconds * 1000 : null
    inMemoryCache.set(messageId, { value: '1', expiry })
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
      console.error('Error closing Redis connection:', error)
    } finally {
      globalRedisClient = null
    }
  }
}
