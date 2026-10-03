import { createLogger } from '@sim/logger'
import { getConfiguredCacheProvider } from '@/lib/core/config/env-capabilities.server'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('Storage')

export type StorageMethod = 'redis' | 'database'

let cachedStorageMethod: StorageMethod | null = null

/**
 * Determine the storage method once based on configuration.
 * This decision is made at first call and cached for the lifetime of the process.
 *
 * - If the cache capability selects Redis and the client initializes → 'redis'
 * - If the cache capability selects the built-in provider → 'database'
 *
 * Transient failures do NOT change the storage method.
 * If Redis is configured but fails, operations will fail (not fallback to DB).
 */
export function getStorageMethod(): StorageMethod {
  if (cachedStorageMethod) {
    return cachedStorageMethod
  }

  if (getConfiguredCacheProvider() === 'redis') {
    const redis = getRedisClient()
    if (!redis) throw new Error('REDIS_URL is configured but the Redis client is unavailable')
    cachedStorageMethod = 'redis'
    logger.info('Storage method: Redis')
  } else {
    cachedStorageMethod = 'database'
    logger.info('Storage method: PostgreSQL')
  }

  return cachedStorageMethod
}

/**
 * Check if Redis is the configured storage method.
 * Use this for conditional logic that depends on storage type.
 */
export function isRedisStorage(): boolean {
  return getStorageMethod() === 'redis'
}

/**
 * Check if database is the configured storage method.
 */
export function isDatabaseStorage(): boolean {
  return getStorageMethod() === 'database'
}

/**
 * Get Redis client, but only if Redis is the configured storage method.
 * Throws if Redis is configured but client is unavailable.
 *
 * Use this instead of getRedisClient() directly when you need to ensure
 * consistency with the storage method decision.
 */
export function requireRedis() {
  if (!isRedisStorage()) {
    throw new Error('Redis storage not configured')
  }

  const redis = getRedisClient()
  if (!redis) {
    throw new Error('Redis client unavailable')
  }

  return redis
}

/**
 * Reset the cached storage method.
 * Only use for testing purposes.
 */
export function resetStorageMethod(): void {
  cachedStorageMethod = null
}
