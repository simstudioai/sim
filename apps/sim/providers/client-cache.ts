import { LRUCache } from 'lru-cache'

/**
 * Shared, bounded, idle-expiring cache of provider SDK clients. Reusing a client
 * across requests lets the underlying HTTP agent keep connections alive, avoiding
 * a fresh TLS handshake (and client construction) on every request.
 *
 * Provider SDK clients (Anthropic, OpenAI, Groq, …) hold no per-request mutable
 * state — abort signals and timeouts are passed at the call site, not on the
 * client — so a single instance is safe to share across concurrent requests.
 *
 * Keys must be namespaced per provider and must encode every input that varies
 * the constructed client. The API key is always part of the key, making it the
 * tenant security boundary: clients are never shared across different keys.
 */

const CLIENT_CACHE_MAX_ENTRIES = 1_000
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1_000

const clientCache = new LRUCache<string, object>({
  max: CLIENT_CACHE_MAX_ENTRIES,
  ttl: CLIENT_CACHE_TTL_MS,
  // Idle expiry: the TTL resets on every hit so a continuously-used client
  // (and its warm keep-alive connections) survives, while idle keys age out.
  updateAgeOnGet: true,
})

/**
 * Returns a cached provider client for the given key, constructing and storing
 * one via `factory` on a miss. The key must encode every input that varies the
 * constructed client (provider namespace + API key at minimum); identical keys
 * safely share a single client instance.
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
