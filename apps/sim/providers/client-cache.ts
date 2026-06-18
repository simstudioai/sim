import { LRUCache } from 'lru-cache'

const CLIENT_CACHE_MAX_ENTRIES = 1_000
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1_000

/**
 * `updateAgeOnGet` makes the TTL idle-based: a continuously-used client keeps its
 * warm keep-alive connections, while idle keys age out.
 */
const clientCache = new LRUCache<string, object>({
  max: CLIENT_CACHE_MAX_ENTRIES,
  ttl: CLIENT_CACHE_TTL_MS,
  updateAgeOnGet: true,
})

/**
 * Memoizes provider SDK clients so connections stay warm across requests rather
 * than re-handshaking per call. The key must be namespaced per provider and
 * encode every input that varies the client; the API key is always part of it,
 * making it the tenant boundary (clients are never shared across keys).
 */
export function getCachedProviderClient<T extends object>(key: string, factory: () => T): T {
  const existing = clientCache.get(key)
  if (existing) {
    return existing as T
  }

  const client = factory()
  clientCache.set(key, client)
  return client
}

/** Clears the cache so tests asserting client construction start from a miss. */
export function clearProviderClientCacheForTests(): void {
  clientCache.clear()
}
