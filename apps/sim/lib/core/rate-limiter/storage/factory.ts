import { createLogger } from '@sim/logger'
import { getRedisClient, onRedisReconnect } from '@/lib/core/config/redis'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'
import type { RateLimitStorageAdapter } from './adapter'
import { DbTokenBucket } from './db-token-bucket'
import { RedisTokenBucket } from './redis-token-bucket'

const logger = createLogger('RateLimitStorage')

type FactoryGlobal = typeof globalThis & {
  _rlCachedAdapter?: RateLimitStorageAdapter | null
  _rlReconnectListenerRegistered?: boolean
}

const g = globalThis as FactoryGlobal
if (!('_rlCachedAdapter' in g)) {
  g._rlCachedAdapter = null
  g._rlReconnectListenerRegistered = false
}

export function createStorageAdapter(): RateLimitStorageAdapter {
  if (g._rlCachedAdapter) {
    return g._rlCachedAdapter
  }

  if (!g._rlReconnectListenerRegistered) {
    onRedisReconnect(() => {
      g._rlCachedAdapter = null
    })
    g._rlReconnectListenerRegistered = true
  }

  const storageMethod = getStorageMethod()

  if (storageMethod === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      logger.warn(
        'Redis configured but client unavailable - falling back to PostgreSQL for rate limiting'
      )
      g._rlCachedAdapter = new DbTokenBucket()
    } else {
      logger.info('Rate limiting: Using Redis')
      g._rlCachedAdapter = new RedisTokenBucket(redis)
    }
  } else {
    logger.info('Rate limiting: Using PostgreSQL')
    g._rlCachedAdapter = new DbTokenBucket()
  }

  return g._rlCachedAdapter!
}

export function getAdapterType(): StorageMethod {
  return getStorageMethod()
}

export function resetStorageAdapter(): void {
  g._rlCachedAdapter = null
}

export function setStorageAdapter(adapter: RateLimitStorageAdapter): void {
  g._rlCachedAdapter = adapter
}
