import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import type { McpCacheStorageAdapter } from './adapter'
import { MemoryMcpCache } from './memory-cache'
import { RedisMcpCache } from './redis-cache'

const logger = createLogger('McpCacheFactory')

let cachedAdapter: McpCacheStorageAdapter | null = null

/**
 * Create MCP cache storage adapter.
 * Uses Redis if available, falls back to in-memory cache.
 *
 * Unlike rate-limiting (which fails if Redis is configured but unavailable),
 * MCP caching gracefully falls back to memory since it's an optimization.
 */
export function createMcpCacheAdapter(): McpCacheStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const redis = getRedisClient()

  if (redis) {
    logger.info('MCP cache: Using Redis')
    cachedAdapter = new RedisMcpCache(redis)
  } else {
    logger.info('MCP cache: Using in-memory (Redis not configured)')
    cachedAdapter = new MemoryMcpCache()
  }

  return cachedAdapter
}

/**
 * Get the current adapter type for logging/debugging
 */
export function getMcpCacheType(): 'redis' | 'memory' {
  const redis = getRedisClient()
  return redis ? 'redis' : 'memory'
}

/**
 * Reset the cached adapter.
 * Only use for testing purposes.
 */
export function resetMcpCacheAdapter(): void {
  if (cachedAdapter) {
    cachedAdapter.dispose()
    cachedAdapter = null
  }
}
