/**
 * Request-scoped carrier for the rate-limit snapshot, so response headers can be
 * attached once at the route boundary instead of at every `return`.
 *
 * A route computes its rate limit at the top of the handler but returns from
 * many places — success, validation failure, not-found, access denied, and the
 * unhandled-error path inside `withRouteHandler`. Decorating each return means
 * the headers are only as complete as the least-careful branch, and a new branch
 * silently ships without them. Recording the snapshot once lets
 * `withRouteHandler` publish it on whatever response comes back.
 *
 * A `WeakMap` keyed by the request avoids `AsyncLocalStorage` plumbing and needs
 * no cleanup: the entry becomes collectable as soon as the request object does.
 * Routes that never record a snapshot (everything outside the v1 API) read
 * `undefined` and are left untouched.
 */
export interface RateLimitSnapshot {
  limit: number
  remaining: number
  resetAt: Date
}

const snapshots = new WeakMap<object, RateLimitSnapshot>()

/**
 * Records the rate-limit snapshot for this request. Called by the v1 middleware
 * once the token bucket has been consulted; a request that fails authentication
 * records nothing, so no quota is published for it.
 */
export function recordRateLimitSnapshot(request: object, snapshot: RateLimitSnapshot): void {
  snapshots.set(request, snapshot)
}

/**
 * The `X-RateLimit-*` trio. The single definition of these header names and
 * their formatting — every emitter goes through here so a change to the header
 * contract lands in one place.
 */
export function buildRateLimitHeaders(snapshot: RateLimitSnapshot): Record<string, string> {
  return {
    'X-RateLimit-Limit': snapshot.limit.toString(),
    'X-RateLimit-Remaining': snapshot.remaining.toString(),
    'X-RateLimit-Reset': snapshot.resetAt.toISOString(),
  }
}

/**
 * Headers for a request, or `null` when no bucket was consulted for it.
 */
export function getRateLimitHeaders(request: object): Record<string, string> | null {
  const snapshot = snapshots.get(request)
  return snapshot ? buildRateLimitHeaders(snapshot) : null
}
