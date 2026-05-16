/** Default retry pacing: 500 ms floor, 30 s ceiling. */
const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_BACKOFF_MAX_MS = 30_000

export interface BackoffOptions {
  baseMs?: number
  maxMs?: number
}

/**
 * Computes the next delay for a retry loop.
 *
 * When `retryAfterMs` is non-null (from a `Retry-After` response header), the
 * value is clamped to `[baseMs, maxMs]` so a malformed `Retry-After: 0` cannot
 * pin the loop into a tight retry. Otherwise returns exponential backoff with
 * ±20% jitter to avoid thundering-herd alignment across concurrent callers.
 * Attempt is 1-indexed.
 */
export function backoffWithJitter(
  attempt: number,
  retryAfterMs: number | null,
  options: BackoffOptions = {}
): number {
  const baseMs = options.baseMs ?? DEFAULT_BACKOFF_BASE_MS
  const maxMs = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS
  if (retryAfterMs !== null) {
    return Math.min(Math.max(retryAfterMs, baseMs), maxMs)
  }
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs)
  // Inline crypto float to avoid cross-file imports within the package (Turbopack limitation)
  const jitter = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
  return exponential * (0.8 + jitter * 0.4)
}

/** Maximum `Retry-After` value honored: 30 s. Prevents a misconfigured upstream from stalling callers. */
const RETRY_AFTER_MAX_MS = 30_000

/**
 * Parses an HTTP `Retry-After` header (either delta-seconds or an HTTP-date)
 * into a millisecond delay, capped at 30 s.
 * Returns `null` when the header is absent or unparseable so callers can fall
 * back to their own backoff.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (trimmed.length === 0) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.floor(seconds * 1000), RETRY_AFTER_MAX_MS)
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    if (delta <= 0) return 0
    return Math.min(delta, RETRY_AFTER_MAX_MS)
  }
  return null
}
