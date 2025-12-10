import { getRedisClient } from '@/lib/core/config/redis'
import { createLogger } from '@/lib/logs/console/logger'
import type { RateLimitStorageAdapter } from './adapter'
import { DbTokenBucket } from './db-token-bucket'
import { RedisTokenBucket } from './redis-token-bucket'

const logger = createLogger('RateLimitStorage')

let cachedAdapter: RateLimitStorageAdapter | null = null

export function createStorageAdapter(): RateLimitStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const redis = getRedisClient()
  if (redis) {
    logger.info('Using Redis for rate limiting')
    cachedAdapter = new RedisTokenBucket(redis)
  } else {
    logger.info('Using PostgreSQL for rate limiting')
    cachedAdapter = new DbTokenBucket()
  }

  return cachedAdapter
}

export function resetStorageAdapter(): void {
  cachedAdapter = null
}

export function setStorageAdapter(adapter: RateLimitStorageAdapter): void {
  cachedAdapter = adapter
}
