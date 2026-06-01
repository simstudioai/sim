import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('AuthRateLimitStorage')

/** Counter shape better-auth persists per rate-limit key. */
interface RateLimitRecord {
  key: string
  count: number
  lastRequest: number
}

/** Structural match for better-auth's `rateLimit.customStorage` option. */
interface RateLimitStorage {
  get: (key: string) => Promise<RateLimitRecord | undefined>
  set: (key: string, value: RateLimitRecord, update?: boolean) => Promise<void>
}

const REDIS_KEY_PREFIX = 'auth-rl:'

/**
 * TTL for stored counters. Correctness comes from the `lastRequest` timestamp
 * comparison in better-auth's limiter, not from expiry — the TTL only bounds
 * key growth. It must be at least as long as the largest configured window so a
 * key never expires mid-window and under-counts.
 */
const REDIS_TTL_SECONDS = 3600

/**
 * Redis-backed storage for better-auth's rate limiter.
 *
 * Returns `undefined` when no Redis is configured, in which case better-auth
 * falls back to its default in-memory store. That store is per-process and
 * resets on deploy, so a long-window per-IP cap only holds across a multi-replica
 * deployment when counts live in shared storage. Backing the limiter with Redis
 * (rather than the primary database) keeps the per-request counter I/O off the
 * Postgres primary.
 *
 * Fail-open: any Redis error resolves `get` to `undefined` (treated as no prior
 * requests) and makes `set` a no-op, so a Redis outage degrades to "allow"
 * rather than locking users out of authentication.
 */
export function buildRedisRateLimitStorage(): RateLimitStorage | undefined {
  if (!getRedisClient()) return undefined

  return {
    get: async (key) => {
      try {
        const redis = getRedisClient()
        if (!redis) return undefined
        const raw = await redis.get(`${REDIS_KEY_PREFIX}${key}`)
        if (!raw) return undefined
        return JSON.parse(raw) as RateLimitRecord
      } catch (error) {
        logger.warn('Rate-limit storage read failed; allowing request', {
          error: getErrorMessage(error),
        })
        return undefined
      }
    },
    set: async (key, value) => {
      try {
        const redis = getRedisClient()
        if (!redis) return
        await redis.set(`${REDIS_KEY_PREFIX}${key}`, JSON.stringify(value), 'EX', REDIS_TTL_SECONDS)
      } catch (error) {
        logger.warn('Rate-limit storage write failed', { error: getErrorMessage(error) })
      }
    },
  }
}
