import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import {
  createStorageAdapter,
  type RateLimitStorageAdapter,
  type TokenBucketConfig,
} from '@/lib/core/rate-limiter/storage'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  type AcquireKeyResult,
  type CustomRateLimit,
  DEFAULT_BURST_MULTIPLIER,
  DEFAULT_WINDOW_MS,
  type HostedKeyRateLimitConfig,
  type ReportUsageResult,
  toTokenBucketConfig,
} from './types'

const logger = createLogger('HostedKeyRateLimiter')

/**
 * Maximum time a hosted-key acquisition will wait for the per-workspace bucket
 * to refill before falling back to a 429. Sized comfortably under the 90-min
 * Trigger.dev container ceiling so a queued call still has time to actually
 * execute after acquisition.
 */
const MAX_QUEUE_WAIT_MS = 5 * 60 * 1000

/**
 * Floor on per-iteration sleep when the bucket reports `retryAfterMs <= 0`,
 * which can happen due to clock skew or sub-millisecond resets. Prevents a
 * tight retry loop hammering the storage adapter.
 */
const MIN_QUEUE_RETRY_DELAY_MS = 50

/** TTL slack on the FIFO lock — a crashed worker can't permanently block its workspace. */
const QUEUE_LOCK_TTL_SECONDS = Math.ceil(MAX_QUEUE_WAIT_MS / 1000) + 30

/**
 * Resolves env var names for a numbered key prefix using a `{PREFIX}_COUNT` env var.
 * E.g. with `EXA_API_KEY_COUNT=5`, returns `['EXA_API_KEY_1', ..., 'EXA_API_KEY_5']`.
 */
function resolveEnvKeys(prefix: string): string[] {
  const count = Number.parseInt(process.env[`${prefix}_COUNT`] || '0', 10)
  const names: string[] = []
  for (let i = 1; i <= count; i++) {
    names.push(`${prefix}_${i}`)
  }
  return names
}

/** Dimension name for per-billing-actor request rate limiting */
const ACTOR_REQUESTS_DIMENSION = 'actor_requests'

/**
 * Information about an available hosted key
 */
interface AvailableKey {
  key: string
  keyIndex: number
  envVarName: string
}

/**
 * HostedKeyRateLimiter provides:
 * 1. Per-billing-actor rate limiting (enforced - blocks actors who exceed their limit)
 * 2. Round-robin key selection (distributes requests evenly across keys)
 * 3. Post-execution dimension usage tracking for custom rate limits
 *
 * The billing actor is typically a workspace ID, meaning rate limits are shared
 * across all users within the same workspace.
 */
export class HostedKeyRateLimiter {
  private storage: RateLimitStorageAdapter
  /** Round-robin counter per provider for even key distribution */
  private roundRobinCounters = new Map<string, number>()

  constructor(storage?: RateLimitStorageAdapter) {
    this.storage = storage ?? createStorageAdapter()
  }

  private buildActorStorageKey(provider: string, billingActorId: string): string {
    return `hosted:${provider}:actor:${billingActorId}:${ACTOR_REQUESTS_DIMENSION}`
  }

  private buildDimensionStorageKey(
    provider: string,
    billingActorId: string,
    dimensionName: string
  ): string {
    return `hosted:${provider}:actor:${billingActorId}:${dimensionName}`
  }

  private getAvailableKeys(envKeys: string[]): AvailableKey[] {
    const keys: AvailableKey[] = []
    for (let i = 0; i < envKeys.length; i++) {
      const envVarName = envKeys[i]
      const key = process.env[envVarName]
      if (key) {
        keys.push({ key, keyIndex: i, envVarName })
      }
    }
    return keys
  }

  /**
   * Build a token bucket config for the per-billing-actor request rate limit.
   * Works for both `per_request` and `custom` modes since both define `requestsPerMinute`.
   */
  private getActorRateLimitConfig(config: HostedKeyRateLimitConfig): TokenBucketConfig | null {
    if (!config.requestsPerMinute) return null
    return toTokenBucketConfig(
      config.requestsPerMinute,
      config.burstMultiplier ?? DEFAULT_BURST_MULTIPLIER,
      DEFAULT_WINDOW_MS
    )
  }

  /**
   * Check and consume billing actor request rate limit. Returns null if allowed, or retry info if blocked.
   */
  private async checkActorRateLimit(
    provider: string,
    billingActorId: string,
    config: HostedKeyRateLimitConfig
  ): Promise<{ rateLimited: true; retryAfterMs: number } | null> {
    const bucketConfig = this.getActorRateLimitConfig(config)
    if (!bucketConfig) return null

    const storageKey = this.buildActorStorageKey(provider, billingActorId)

    try {
      const result = await this.storage.consumeTokens(storageKey, 1, bucketConfig)
      if (!result.allowed) {
        const retryAfterMs = Math.max(0, result.resetAt.getTime() - Date.now())
        logger.info(`Billing actor ${billingActorId} rate limited for ${provider}`, {
          provider,
          billingActorId,
          retryAfterMs,
          tokensRemaining: result.tokensRemaining,
        })
        return { rateLimited: true, retryAfterMs }
      }
      return null
    } catch (error) {
      logger.error(`Error checking billing actor rate limit for ${provider}`, {
        error,
        billingActorId,
      })
      return null
    }
  }

  /**
   * Pre-check that the billing actor has available budget in all custom dimensions.
   * Does NOT consume tokens -- just verifies the actor isn't already depleted.
   * Returns retry info for the most restrictive exhausted dimension, or null if all pass.
   */
  private async preCheckDimensions(
    provider: string,
    billingActorId: string,
    config: CustomRateLimit
  ): Promise<{ rateLimited: true; retryAfterMs: number; dimension: string } | null> {
    for (const dimension of config.dimensions) {
      const storageKey = this.buildDimensionStorageKey(provider, billingActorId, dimension.name)
      const bucketConfig = toTokenBucketConfig(
        dimension.limitPerMinute,
        dimension.burstMultiplier ?? DEFAULT_BURST_MULTIPLIER,
        DEFAULT_WINDOW_MS
      )

      try {
        const status = await this.storage.getTokenStatus(storageKey, bucketConfig)
        if (status.tokensAvailable < 1) {
          const retryAfterMs = Math.max(0, status.nextRefillAt.getTime() - Date.now())
          logger.info(
            `Billing actor ${billingActorId} exhausted dimension ${dimension.name} for ${provider}`,
            {
              provider,
              billingActorId,
              dimension: dimension.name,
              tokensAvailable: status.tokensAvailable,
              retryAfterMs,
            }
          )
          return { rateLimited: true, retryAfterMs, dimension: dimension.name }
        }
      } catch (error) {
        logger.error(`Error pre-checking dimension ${dimension.name} for ${provider}`, {
          error,
          billingActorId,
        })
      }
    }
    return null
  }

  /**
   * Acquire an available key via round-robin selection.
   *
   * For both modes:
   *   1. Per-billing-actor request rate limiting (enforced): when the actor is over their
   *      limit, the call blocks (waits for refill) up to `MAX_QUEUE_WAIT_MS`. A Redis
   *      FIFO lock keyed on `{provider, billingActorId}` keeps callers in the same
   *      workspace serialized so the bucket drains predictably.
   *   2. Round-robin key selection: cycles through available keys for even distribution
   *
   * For `custom` mode additionally:
   *   3. Pre-checks dimension budgets: same wait-for-refill behavior if a dimension is depleted
   *
   * If the wait exceeds the cap, the call falls back to today's 429 result.
   *
   * @param envKeyPrefix - Env var prefix (e.g. 'EXA_API_KEY'). Keys resolved via `{prefix}_COUNT`.
   * @param billingActorId - The billing actor (typically workspace ID) to rate limit against
   */
  async acquireKey(
    provider: string,
    envKeyPrefix: string,
    config: HostedKeyRateLimitConfig,
    billingActorId: string
  ): Promise<AcquireKeyResult> {
    const lockKey = `hosted-queue:${provider}:${billingActorId}`
    const lockValue = generateShortId()
    const lockHeld = await this.acquireFifoLock(lockKey, lockValue)

    try {
      if (config.requestsPerMinute) {
        const rateLimitResult = await this.waitForActorCapacity(provider, billingActorId, config)
        if (rateLimitResult.rateLimited) {
          return {
            success: false,
            billingActorRateLimited: true,
            retryAfterMs: rateLimitResult.retryAfterMs,
            error: `Rate limit exceeded. Please wait ${Math.ceil(rateLimitResult.retryAfterMs / 1000)} seconds. If you're getting throttled frequently, consider adding your own API key under Settings > BYOK to avoid shared rate limits.`,
          }
        }
      }

      if (config.mode === 'custom' && config.dimensions.length > 0) {
        const dimensionResult = await this.waitForDimensionCapacity(
          provider,
          billingActorId,
          config
        )
        if (dimensionResult.rateLimited) {
          return {
            success: false,
            billingActorRateLimited: true,
            retryAfterMs: dimensionResult.retryAfterMs,
            error: `Rate limit exceeded for ${dimensionResult.dimension}. Please wait ${Math.ceil(dimensionResult.retryAfterMs / 1000)} seconds. If you're getting throttled frequently, consider adding your own API key under Settings > BYOK to avoid shared rate limits.`,
          }
        }
      }

      const envKeys = resolveEnvKeys(envKeyPrefix)
      const availableKeys = this.getAvailableKeys(envKeys)

      if (availableKeys.length === 0) {
        logger.warn(`No hosted keys configured for provider ${provider}`)
        return {
          success: false,
          error: `No hosted keys configured for ${provider}`,
        }
      }

      const counter = this.roundRobinCounters.get(provider) ?? 0
      const selected = availableKeys[counter % availableKeys.length]
      this.roundRobinCounters.set(provider, counter + 1)

      logger.debug(`Selected hosted key for ${provider}`, {
        provider,
        keyIndex: selected.keyIndex,
        envVarName: selected.envVarName,
      })

      return {
        success: true,
        key: selected.key,
        keyIndex: selected.keyIndex,
        envVarName: selected.envVarName,
      }
    } finally {
      if (lockHeld) {
        await this.releaseFifoLock(lockKey, lockValue)
      }
    }
  }

  /**
   * Acquire the per-workspace+provider FIFO lock that serializes queue waits.
   * Returns true if the lock was held by this caller (or Redis is unavailable, in which
   * case the lock is a no-op and we proceed without fairness). Returns false if the lock
   * is already held by another caller and we should still proceed without waiting on it
   * (correctness is preserved by the token bucket; we just lose fairness).
   */
  private async acquireFifoLock(lockKey: string, lockValue: string): Promise<boolean> {
    try {
      return await acquireLock(lockKey, lockValue, QUEUE_LOCK_TTL_SECONDS)
    } catch (error) {
      logger.warn(`Failed to acquire hosted-queue FIFO lock ${lockKey}`, { error })
      return false
    }
  }

  /**
   * Release the per-workspace+provider FIFO lock. Best-effort; logs but does not throw.
   */
  private async releaseFifoLock(lockKey: string, lockValue: string): Promise<void> {
    try {
      await releaseLock(lockKey, lockValue)
    } catch (error) {
      logger.warn(`Failed to release hosted-queue FIFO lock ${lockKey}`, { error })
    }
  }

  /**
   * Wait for actor request-rate capacity. Re-checks the bucket after each refill window
   * up to `MAX_QUEUE_WAIT_MS`. Returns `{ rateLimited: false }` once a token has been
   * consumed (the underlying check is consume-on-success, matching the original behavior).
   */
  private async waitForActorCapacity(
    provider: string,
    billingActorId: string,
    config: HostedKeyRateLimitConfig
  ): Promise<{ rateLimited: false } | { rateLimited: true; retryAfterMs: number }> {
    const startedAt = Date.now()
    let attempts = 0

    while (true) {
      const result = await this.checkActorRateLimit(provider, billingActorId, config)
      attempts++

      if (!result) {
        if (attempts > 1) {
          PlatformEvents.hostedKeyQueueWaited({
            provider,
            workspaceId: billingActorId,
            waitedMs: Date.now() - startedAt,
            attempts,
            reason: 'actor_requests',
          })
        }
        return { rateLimited: false }
      }

      const elapsed = Date.now() - startedAt
      const remaining = MAX_QUEUE_WAIT_MS - elapsed
      if (remaining <= 0 || result.retryAfterMs > remaining) {
        PlatformEvents.hostedKeyQueueWaitExceeded({
          provider,
          workspaceId: billingActorId,
          waitedMs: elapsed,
          reason: 'actor_requests',
        })
        return { rateLimited: true, retryAfterMs: result.retryAfterMs }
      }

      const sleepMs = Math.max(MIN_QUEUE_RETRY_DELAY_MS, result.retryAfterMs)
      await sleep(sleepMs)
    }
  }

  /**
   * Wait for custom-mode dimension capacity. `preCheckDimensions` is read-only — it does
   * not consume — so re-running it after a sleep is safe and does not double-charge.
   * Post-execution `reportUsage` performs the actual consumption.
   */
  private async waitForDimensionCapacity(
    provider: string,
    billingActorId: string,
    config: CustomRateLimit
  ): Promise<
    { rateLimited: false } | { rateLimited: true; retryAfterMs: number; dimension: string }
  > {
    const startedAt = Date.now()
    let attempts = 0

    while (true) {
      const result = await this.preCheckDimensions(provider, billingActorId, config)
      attempts++

      if (!result) {
        if (attempts > 1) {
          PlatformEvents.hostedKeyQueueWaited({
            provider,
            workspaceId: billingActorId,
            waitedMs: Date.now() - startedAt,
            attempts,
            reason: 'dimension',
          })
        }
        return { rateLimited: false }
      }

      const elapsed = Date.now() - startedAt
      const remaining = MAX_QUEUE_WAIT_MS - elapsed
      if (remaining <= 0 || result.retryAfterMs > remaining) {
        PlatformEvents.hostedKeyQueueWaitExceeded({
          provider,
          workspaceId: billingActorId,
          waitedMs: elapsed,
          reason: 'dimension',
          dimension: result.dimension,
        })
        return {
          rateLimited: true,
          retryAfterMs: result.retryAfterMs,
          dimension: result.dimension,
        }
      }

      const sleepMs = Math.max(MIN_QUEUE_RETRY_DELAY_MS, result.retryAfterMs)
      await sleep(sleepMs)
    }
  }

  /**
   * Report actual usage after successful tool execution (custom mode only).
   * Calls `extractUsage` on each dimension and consumes the actual token count.
   * This is the "post-execution" phase of the optimistic two-phase approach.
   */
  async reportUsage(
    provider: string,
    billingActorId: string,
    config: CustomRateLimit,
    params: Record<string, unknown>,
    response: Record<string, unknown>
  ): Promise<ReportUsageResult> {
    const results: ReportUsageResult['dimensions'] = []

    for (const dimension of config.dimensions) {
      let usage: number
      try {
        usage = dimension.extractUsage(params, response)
      } catch (error) {
        logger.error(`Failed to extract usage for dimension ${dimension.name}`, {
          provider,
          billingActorId,
          error,
        })
        continue
      }

      if (usage <= 0) {
        results.push({
          name: dimension.name,
          consumed: 0,
          allowed: true,
          tokensRemaining: 0,
        })
        continue
      }

      const storageKey = this.buildDimensionStorageKey(provider, billingActorId, dimension.name)
      const bucketConfig = toTokenBucketConfig(
        dimension.limitPerMinute,
        dimension.burstMultiplier ?? DEFAULT_BURST_MULTIPLIER,
        DEFAULT_WINDOW_MS
      )

      try {
        const consumeResult = await this.storage.consumeTokens(storageKey, usage, bucketConfig)

        results.push({
          name: dimension.name,
          consumed: usage,
          allowed: consumeResult.allowed,
          tokensRemaining: consumeResult.tokensRemaining,
        })

        if (!consumeResult.allowed) {
          logger.warn(
            `Dimension ${dimension.name} overdrawn for ${provider} (optimistic concurrency)`,
            { provider, billingActorId, usage, tokensRemaining: consumeResult.tokensRemaining }
          )
        }

        logger.debug(`Consumed ${usage} from dimension ${dimension.name} for ${provider}`, {
          provider,
          billingActorId,
          usage,
          allowed: consumeResult.allowed,
          tokensRemaining: consumeResult.tokensRemaining,
        })
      } catch (error) {
        logger.error(`Failed to consume tokens for dimension ${dimension.name}`, {
          provider,
          billingActorId,
          usage,
          error,
        })
      }
    }

    return { dimensions: results }
  }
}

let cachedInstance: HostedKeyRateLimiter | null = null

/**
 * Get the singleton HostedKeyRateLimiter instance
 */
export function getHostedKeyRateLimiter(): HostedKeyRateLimiter {
  if (!cachedInstance) {
    cachedInstance = new HostedKeyRateLimiter()
  }
  return cachedInstance
}

/**
 * Reset the cached rate limiter (for testing)
 */
export function resetHostedKeyRateLimiter(): void {
  cachedInstance = null
}
