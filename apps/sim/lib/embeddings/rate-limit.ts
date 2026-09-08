import { parseRetryAfter } from '@sim/utils/retry'

/**
 * Reads the wait an embedding provider states when it rejects a request for
 * rate limiting, in milliseconds, or `null` when the response says nothing
 * usable and the caller should fall back to its own backoff.
 *
 * Kept out of the shared connector helper in `@/lib/knowledge/documents/utils`
 * deliberately. That module reads `x-ratelimit-reset` as UTC epoch seconds,
 * which is what GitHub and X document; the OpenAI family spells the same idea as
 * `x-ratelimit-reset-tokens` carrying a Go duration. Teaching the shared reader
 * both spellings would change the retry behaviour of every connector that goes
 * through `fetchWithRetry`, so the provider-specific reading stays here.
 */
interface HeaderReader {
  get(name: string): string | null
}

/** Milliseconds per Go duration unit. Longer spellings first — `ms` must win over `m`. */
const GO_DURATION_UNITS = [
  ['ns', 1e-6],
  ['us', 1e-3],
  ['µs', 1e-3],
  ['ms', 1],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1000],
] as const

const GO_DURATION_PART = /(\d+(?:\.\d+)?)(ns|us|µs|ms|h|m|s)/gy

/**
 * Parses a Go duration such as `6m0s`, `12ms`, or `23h47m36.648s` — the format
 * OpenAI uses for its rate-limit reset headers — into milliseconds.
 *
 * Returns `null` for anything the format does not fully describe, so a value in
 * some other shape falls back to backoff rather than being half-read. The sticky
 * match and the end-of-input check are what enforce that: `m` and `ms` share a
 * prefix, so a parser scanning loosely would read `12ms` as twelve minutes.
 */
export function parseGoDurationMs(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  GO_DURATION_PART.lastIndex = 0
  let total = 0
  let matched = false

  while (GO_DURATION_PART.lastIndex < trimmed.length) {
    const part = GO_DURATION_PART.exec(trimmed)
    if (!part) return null
    const unit = GO_DURATION_UNITS.find(([name]) => name === part[2])
    if (!unit) return null
    total += Number(part[1]) * unit[1]
    matched = true
  }

  return matched ? total : null
}

/** Paired remaining/reset headers, per rate-limited dimension. */
const OPENAI_LIMIT_DIMENSIONS = [
  { remaining: 'x-ratelimit-remaining-project-tokens', reset: 'x-ratelimit-reset-project-tokens' },
  { remaining: 'x-ratelimit-remaining-tokens', reset: 'x-ratelimit-reset-tokens' },
  { remaining: 'x-ratelimit-remaining-requests', reset: 'x-ratelimit-reset-requests' },
] as const

/**
 * Resolves the stated wait for a rejected embedding request.
 *
 * `Retry-After` wins when present, since the provider is naming the wait
 * directly. Otherwise the reset header is read for whichever dimension is
 * actually exhausted — a tokens-per-minute rejection and a requests-per-minute
 * rejection reopen at different times, and the reset for a dimension with quota
 * left says nothing about when this request may be retried. When both are
 * exhausted the longer wait is the one that governs.
 */
export function resolveEmbeddingRetryDelayMs(headers: HeaderReader): number | null {
  const retryAfterMs = parseRetryAfter(headers.get('retry-after'), Number.POSITIVE_INFINITY)
  if (retryAfterMs !== null && retryAfterMs > 0) return retryAfterMs

  let longest: number | null = null
  for (const dimension of OPENAI_LIMIT_DIMENSIONS) {
    if (headers.get(dimension.remaining) !== '0') continue
    const reset = headers.get(dimension.reset)
    if (!reset) continue
    const waitMs = parseGoDurationMs(reset)
    if (waitMs === null || waitMs <= 0) continue
    longest = longest === null ? waitMs : Math.max(longest, waitMs)
  }

  return longest
}
