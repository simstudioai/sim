import { getRedisClient, onRedisReconnect } from '@/lib/core/config/redis'
import type { RateLimitStorageAdapter } from '@/lib/core/rate-limiter/storage/adapter'
import { RedisTokenBucket } from '@/lib/core/rate-limiter/storage/redis-token-bucket'

type FactoryGlobal = typeof globalThis & {
  _rlCachedAdapter?: RateLimitStorageAdapter | null
  _rlReconnectListenerRegistered?: boolean
}

const g = globalThis as FactoryGlobal
if (!('_rlCachedAdapter' in g)) {
  g._rlCachedAdapter = null
  g._rlReconnectListenerRegistered = false
}

/**
 * The shared Redis token-bucket adapter. It is cached until the Redis health
 * check replaces the client, so every caller reaches the current connection.
 */
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

  const adapter = new RedisTokenBucket(getRedisClient())
  g._rlCachedAdapter = adapter
  return adapter
}

export function resetStorageAdapter(): void {
  g._rlCachedAdapter = null
}
