import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'

export type HostedKeyRateLimitMode = 'per_request' | 'custom'

/**
 * Simple per-request rate limit configuration.
 * Enforces per-billing-actor rate limiting and distributes requests across keys.
 */
export interface PerRequestRateLimit {
  mode: 'per_request'
  /** Maximum requests per minute per billing actor (enforced - blocks if exceeded) */
  requestsPerMinute: number
  /** Burst multiplier for token bucket max capacity. Default: 2 */
  burstMultiplier?: number
}

/**
 * Custom rate limit with multiple dimensions (e.g., tokens, search units).
 * Allows tracking different usage metrics independently.
 */
export interface CustomRateLimit {
  mode: 'custom'
  /** Maximum requests per minute per billing actor (enforced - blocks if exceeded) */
  requestsPerMinute: number
  /** Multiple dimensions to track */
  dimensions: RateLimitDimension[]
  /** Burst multiplier for token bucket max capacity. Default: 2 */
  burstMultiplier?: number
}

/**
 * A single dimension for custom rate limiting.
 * Each dimension has its own token bucket.
 */
export interface RateLimitDimension {
  /** Dimension name (e.g., 'tokens', 'search_units') - used in storage key */
  name: string
  /** Limit per minute for this dimension */
  limitPerMinute: number
  /** Burst multiplier for token bucket max capacity. Default: 2 */
  burstMultiplier?: number
  /**
   * Extract usage amount from request params and response.
   * Called after successful execution to consume the actual usage.
   */
  extractUsage: (params: Record<string, unknown>, response: Record<string, unknown>) => number
}

/** Union of all hosted key rate limit configuration types */
export type HostedKeyRateLimitConfig = PerRequestRateLimit | CustomRateLimit

/**
 * Result from acquiring a key from the hosted key rate limiter
 */
export interface AcquireKeyResult {
  /** Whether a key was successfully acquired */
  success: boolean
  /** The API key value (if success=true) */
  key?: string
  /** Index of the key in the envKeys array */
  keyIndex?: number
  /** Environment variable name of the selected key */
  envVarName?: string
  /** Error message if no key available */
  error?: string
  /** Whether the billing actor was rate limited (exceeded their limit) */
  billingActorRateLimited?: boolean
  /** Milliseconds until the billing actor's rate limit resets (if billingActorRateLimited=true) */
  retryAfterMs?: number
}

/**
 * Result from reporting post-execution usage for custom dimensions
 */
export interface ReportUsageResult {
  /** Per-dimension consumption results */
  dimensions: {
    name: string
    consumed: number
    allowed: boolean
    tokensRemaining: number
  }[]
}

/**
 * Convert rate limit config to token bucket config for a dimension
 */
export function toTokenBucketConfig(
  limitPerMinute: number,
  burstMultiplier = 2,
  windowMs = 60000
): TokenBucketConfig {
  return {
    maxTokens: limitPerMinute * burstMultiplier,
    refillRate: limitPerMinute,
    refillIntervalMs: windowMs,
  }
}

/**
 * Default rate limit window in milliseconds (1 minute)
 */
export const DEFAULT_WINDOW_MS = 60000

/**
 * Default burst multiplier
 */
export const DEFAULT_BURST_MULTIPLIER = 2
