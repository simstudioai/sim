import { sha256Hex } from '@sim/security/hash'
import { parseRetryAfter } from '@sim/utils/retry'
import { LRUCache } from 'lru-cache'
import {
  type HTTPError,
  isRetryableError,
  type RetryOptions,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'

const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'

const DISCOVERY_REQUEST_TIMEOUT_MS = 5_000

/**
 * A site's `cloudId` is a property of the site rather than of the caller — the
 * unauthenticated `https://{domain}/_edge/tenant_info` endpoint serves the same
 * value — which is what makes one entry safe to share across callers. Every other
 * use of this cache justifies its own key at the call site.
 *
 * Bounded and short-lived on purpose: `max` stops a long-lived replica from
 * accumulating an entry for every tenant it has ever served, and the TTL lets a
 * re-pointed site be picked up without a redeploy.
 */
const DISCOVERY_CACHE_MAX_ENTRIES = 64
const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000

/**
 * Builds a memo for one kind of discovery answer. Call at module scope — an
 * `LRUCache` preallocates its backing arrays, so a per-request instance would
 * both leak and defeat the point.
 */
export function createAtlassianDiscoveryCache() {
  const cache = new LRUCache<string, Promise<string>>({
    max: DISCOVERY_CACHE_MAX_ENTRIES,
    ttl: DISCOVERY_CACHE_TTL_MS,
  })

  return {
    /**
     * Returns the memoized answer for `key`, starting `resolver` on a miss.
     *
     * The promise — not the resolved value — is stored, so callers arriving while
     * a lookup is in flight join it instead of starting their own, and a rejection
     * is evicted rather than pinned for the TTL.
     *
     * `key` must identify the credential as well as the resource — a joined caller
     * receives the first caller's outcome, so a domain-only key would let one
     * token's authorization failure or single-site fallback answer another's.
     */
    resolve(key: string, resolver: () => Promise<string>): Promise<string> {
      const cached = cache.get(key)
      if (cached) return cached

      const promise = resolver().catch((error) => {
        cache.delete(key)
        throw error
      })

      cache.set(key, promise)
      return promise
    },

    /** Drops every memoized answer. Exists for tests. */
    clear(): void {
      cache.clear()
    },
  }
}

/**
 * Discovery is an idempotent GET, so replaying a 5xx cannot duplicate work — which
 * is why this widening is scoped here rather than pushed into the shared predicate
 * that also guards non-idempotent writes.
 *
 * The budget is deliberately tighter than the shared ~31s default: discovery is a
 * fast hop a block waits on, so four attempts across ~3.5s is the useful range. A
 * `Retry-After` still wins over the backoff, capped at `maxDelayMs`, so a
 * server-directed wait can exceed that window.
 *
 * `>= 500` rather than `=== 500` matches `lib/knowledge/reranker.ts` and
 * `lib/embeddings/client.ts`, and covers the 502/507/52x an edge can emit.
 */
export const ATLASSIAN_DISCOVERY_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8000,
  retryCondition: (error) => {
    if (isRetryableError(error)) return true
    // The request's own `AbortSignal.timeout` rejects with a `TimeoutError` that
    // carries no status and no message the shared predicate matches, so without
    // this a slow site would fail on the first attempt. Only `TimeoutError` — an
    // `AbortError` would mean a caller cancelled and does not want a replay.
    if (error instanceof Error && error.name === 'TimeoutError') return true
    const status = (error as { status?: unknown } | null)?.status
    return typeof status === 'number' && status >= 500
  },
}

interface AccessibleResource {
  id: string
  url: string
}

function isAccessibleResource(value: unknown): value is AccessibleResource {
  if (typeof value !== 'object' || value === null) return false
  const resource = value as Record<string, unknown>
  return (
    typeof resource.id === 'string' &&
    resource.id.trim().length > 0 &&
    typeof resource.url === 'string' &&
    resource.url.trim().length > 0
  )
}

interface ResolveAtlassianCloudIdOptions {
  domain: string
  accessToken: string
  /** Product name woven into the failure messages, e.g. `Jira` or `Confluence`. */
  product: string
  retryOptions?: RetryOptions
  /** Require the configured site instead of accepting a credential's sole other site. */
  requireExactMatch?: boolean
}

const cloudIdCache = createAtlassianDiscoveryCache()

/**
 * Reduces an Atlassian site domain to the canonical `https://host` form that
 * `accessible-resources` reports in its `url` field.
 */
export function normalizeAtlassianSiteUrl(domain: string): string {
  return `https://${domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')}`.toLowerCase()
}

/**
 * GETs an Atlassian discovery endpoint as JSON, replaying transient faults.
 *
 * Deliberately not built on `fetchWithRetry`: that helper decides whether a
 * non-OK status enters the retry loop using a hardcoded `isRetryableError`, so a
 * caller-supplied `retryCondition` can never widen the set — a 500 comes back as
 * an un-thrown response and the transient-5xx budget above is silently inert.
 * Raising the failure here also keeps `failureLabel` on every status, rather than
 * the bare `HTTP <status>` the shared wrapper emits for the few it does throw on,
 * which is the string operators and alerts match on.
 *
 * @param retryOptions - Merged over the discovery defaults, so a caller passing
 * counts and delays only (as the connectors do) keeps the transient-5xx condition.
 */
export function fetchAtlassianDiscoveryJson<T>(
  url: string,
  headers: Record<string, string>,
  failureLabel: string,
  retryOptions?: RetryOptions
): Promise<T> {
  return retryWithExponentialBackoff(
    async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(DISCOVERY_REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        const errorText = await response.text()
        const error: HTTPError = new Error(
          `${failureLabel}: ${response.status} - ${errorText || response.statusText}`
        )
        error.status = response.status
        error.statusText = response.statusText
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'))
        if (retryAfterMs) error.retryAfterMs = retryAfterMs
        throw error
      }

      return (await response.json()) as T
    },
    { ...ATLASSIAN_DISCOVERY_RETRY_OPTIONS, ...retryOptions }
  )
}

function fetchAccessibleResources(
  accessToken: string,
  product: string,
  retryOptions: RetryOptions | undefined
): Promise<AccessibleResource[]> {
  return fetchAtlassianDiscoveryJson<AccessibleResource[]>(
    ACCESSIBLE_RESOURCES_URL,
    { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    `Failed to fetch ${product} accessible resources`,
    retryOptions
  )
}

/**
 * Cache key for a discovery answer, scoped to the credential that produced it.
 *
 * What `accessible-resources` reports depends on the token, so an answer is only
 * reusable by the same token. The digest keeps the raw token out of the key.
 */
export function atlassianDiscoveryKey(resource: string, accessToken: string): string {
  return `${resource}:${sha256Hex(accessToken).slice(0, 16)}`
}

/**
 * The credential reaches no Atlassian site at all. Typed so a caller acting
 * for one person can tell "this person is not on the site" from a transport
 * failure or a misconfigured domain.
 */
export class AtlassianSiteNotAccessibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AtlassianSiteNotAccessibleError'
  }
}

/** The credential reaches sites, but none matches the configured domain. */
export class AtlassianSiteNotMatchedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AtlassianSiteNotMatchedError'
  }
}

/**
 * Picks the `cloudId` for `domain` out of an `accessible-resources` payload.
 *
 * Separate from the fetch so a caller that already holds the payload can match
 * against it instead of issuing the request a second time.
 */
export function selectAtlassianCloudId(
  resources: unknown,
  domain: string,
  product: string,
  requireExactMatch = false
): string {
  if (!Array.isArray(resources) || !resources.every(isAccessibleResource)) {
    throw new Error(`Invalid ${product} accessible-resources response`)
  }

  if (resources.length === 0) {
    throw new AtlassianSiteNotAccessibleError(
      `No ${product} sites are accessible to this credential. ` +
        'Reconnect the credential and grant access to the configured Atlassian site.'
    )
  }

  const siteUrl = normalizeAtlassianSiteUrl(domain)
  const match = resources.find((r) => normalizeAtlassianSiteUrl(r.url) === siteUrl)
  if (match) return match.id

  if (!requireExactMatch && resources.length === 1) return resources[0].id

  throw new AtlassianSiteNotMatchedError(
    `Could not match ${product} domain "${domain}" to any accessible resource. ` +
      `Available sites: ${resources.map((r) => r.url).join(', ')}`
  )
}

/**
 * Resolves the Atlassian `cloudId` for a site domain, memoized per credential.
 *
 * Jira, Confluence, and JSM all read the same `accessible-resources` endpoint, so
 * a run touching several Atlassian blocks shares one round trip and one retry
 * budget.
 */
export async function resolveAtlassianCloudId(
  options: ResolveAtlassianCloudIdOptions
): Promise<string> {
  const { domain, accessToken, product, retryOptions, requireExactMatch = false } = options
  const key = `${requireExactMatch ? 'exact' : 'fallback'}:${atlassianDiscoveryKey(normalizeAtlassianSiteUrl(domain), accessToken)}`

  return cloudIdCache.resolve(key, async () =>
    selectAtlassianCloudId(
      await fetchAccessibleResources(accessToken, product, retryOptions),
      domain,
      product,
      requireExactMatch
    )
  )
}

/** Drops every memoized `cloudId`. Exists for tests. */
export function clearAtlassianCloudIdCache(): void {
  cloudIdCache.clear()
}
