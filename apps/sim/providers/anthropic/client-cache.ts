import type Anthropic from '@anthropic-ai/sdk'
import { LRUCache } from 'lru-cache'

/**
 * Bounded, idle-expiring cache of Anthropic SDK clients keyed by the inputs that
 * affect client construction. Reusing a client across requests lets the
 * underlying HTTP agent keep connections alive, avoiding a fresh TLS handshake
 * on every request.
 *
 * The SDK client holds no per-request mutable state — abort signals are passed
 * at the `.messages.create()` / `.stream()` call sites, not on the client — so a
 * single client can be shared safely across concurrent requests.
 *
 * The `apiKey` is always part of the cache key, making it the tenant security
 * boundary: clients are never shared across different API keys.
 */

const CLIENT_CACHE_MAX_ENTRIES = 1_000
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1_000

const clientCache = new LRUCache<string, Anthropic>({
  max: CLIENT_CACHE_MAX_ENTRIES,
  ttl: CLIENT_CACHE_TTL_MS,
  // Idle expiry: the TTL resets on every hit so a continuously-used client
  // (and its warm keep-alive connections) survives, while idle keys age out.
  updateAgeOnGet: true,
})

/**
 * Returns a cached Anthropic client for the given key, constructing and storing
 * one via `factory` on a miss. The key must encode every input that varies the
 * constructed client (at minimum the API key); identical keys safely share a
 * single client instance.
 */
export function getCachedAnthropicClient(key: string, factory: () => Anthropic): Anthropic {
  const existing = clientCache.get(key)
  if (existing) {
    return existing
  }

  const client = factory()
  clientCache.set(key, client)
  return client
}
