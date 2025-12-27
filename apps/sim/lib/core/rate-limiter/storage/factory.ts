import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'
import type { RateLimitStorageAdapter } from './adapter'
import { DbTokenBucket } from './db-token-bucket'
import { RedisTokenBucket } from './redis-token-bucket'

const logger = createLogger('RateLimitStorage')

let cachedAdapter: RateLimitStorageAdapter | null = null

export function createStorageAdapter(): RateLimitStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis configured but client unavailable')
    }
    logger.info('Rate limiting: Using Redis')
    cachedAdapter = new RedisTokenBucket(redis)
  } else {
    logger.info('Rate limiting: Using PostgreSQL')
    cachedAdapter = new DbTokenBucket()
  }

  return cachedAdapter
}

export function getAdapterType(): StorageMethod {
  return getStorageMethod()
}

export function resetStorageAdapter(): void {
  cachedAdapter = null
}

export function setStorageAdapter(adapter: RateLimitStorageAdapter): void {
  cachedAdapter = adapter
}
