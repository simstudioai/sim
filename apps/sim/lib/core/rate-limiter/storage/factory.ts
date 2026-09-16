import { createLogger } from '@sim/logger'
import { getRedisClient, onRedisReconnect } from '@/lib/core/config/redis'
import type { RateLimitStorageAdapter } from '@/lib/core/rate-limiter/storage/adapter'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'
import { RedisTokenBucket } from '@/lib/core/rate-limiter/storage/redis-token-bucket'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'

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

export function createStorageAdapter(
  options: { requireConfiguredBackend?: boolean } = {}
): RateLimitStorageAdapter {
  /** Provider quotas cannot split across two backends when only some workers lose Redis. */
  if (options.requireConfiguredBackend) {
    if (getStorageMethod() !== 'redis') return new DbTokenBucket()
    const redis = getRedisClient()
    if (!redis) throw new Error('Configured Redis rate limit storage is unavailable')
    return new RedisTokenBucket(redis)
  }
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
