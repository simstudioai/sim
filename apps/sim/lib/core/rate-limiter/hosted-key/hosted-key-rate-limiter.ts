import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import {
  createStorageAdapter,
  type RateLimitStorageAdapter,
  type TokenBucketConfig,
} from '@/lib/core/rate-limiter/storage'
import { PlatformEvents } from '@/lib/core/telemetry'
import { getHostedKeyQueue, HEARTBEAT_REFRESH_INTERVAL_MS, type HostedKeyQueue } from './queue'
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

/**
 * Poll interval while waiting to reach the head of the FIFO queue. 200ms balances
 * acquisition latency (worst-case wait for advancement is one poll period) against
 * Redis load — at this cadence, N waiters generate N×5 EVAL/sec, which is fine for
 * the typical low-tens contention. Revisit if telemetry shows hot Redis under load.
 */
const QUEUE_HEAD_POLL_MS = 200

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
  private queue: HostedKeyQueue
  /** Round-robin counter per provider for even key distribution */
  private roundRobinCounters = new Map<string, number>()

  constructor(storage?: RateLimitStorageAdapter, queue?: HostedKeyQueue) {
    this.storage = storage ?? createStorageAdapter()
    this.queue = queue ?? getHostedKeyQueue()
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
   *   1. Per-billing-actor request rate limiting (enforced): the call enqueues itself
   *      onto a per-workspace+provider FIFO queue. Only the head of the queue attempts
   *      to consume from the token bucket, guaranteeing strict ordering across callers
   *      within a workspace. Different workspaces have independent queues and don't
   *      block each other.
   *   2. Round-robin key selection: cycles through available keys for even distribution
   *
   * For `custom` mode additionally:
   *   3. Pre-checks dimension budgets: head waits on dimension refill the same way it
   *      waits on actor request capacity.
   *
   * If the total wait (queue position + bucket refill) exceeds `MAX_QUEUE_WAIT_MS`, the
   * call falls back to today's 429 result. The ticket is removed from the queue on exit
   * regardless of success or failure.
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
    const ticketId = generateShortId()
    const startedAt = Date.now()
    const enqueueResult = await this.queue.enqueue(provider, billingActorId, ticketId)

    try {
      // Wait for our turn at the head of the queue (no-op when Redis unavailable).
      const headStatus = await this.waitForQueueHead(provider, billingActorId, ticketId, startedAt)
      if (headStatus.timedOut) {
        PlatformEvents.hostedKeyQueueWaitExceeded({
          provider,
          workspaceId: billingActorId,
          waitedMs: Date.now() - startedAt,
          reason: 'queue_position',
        })
        return {
          success: false,
          billingActorRateLimited: true,
          retryAfterMs: MAX_QUEUE_WAIT_MS,
          error: `Rate limit exceeded — request waited too long in the queue. If you're getting throttled frequently, consider adding your own API key under Settings > BYOK to avoid shared rate limits.`,
        }
      }

      if (config.requestsPerMinute) {
        const rateLimitResult = await this.waitForActorCapacity(
          provider,
          billingActorId,
          ticketId,
          config,
          startedAt
        )
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
          ticketId,
          config,
          startedAt
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

      const totalWaitedMs = Date.now() - startedAt
      if (enqueueResult.enabled && (enqueueResult.position > 0 || totalWaitedMs > 100)) {
        PlatformEvents.hostedKeyQueueWaited({
          provider,
          workspaceId: billingActorId,
          waitedMs: totalWaitedMs,
          attempts: 1,
          reason: 'queue_position',
          queuePosition: enqueueResult.position,
        })
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
      // Always remove our ticket so the next caller can advance, regardless of whether
      // we succeeded, hit the cap, or threw. Best-effort; safe to call multiple times.
      await this.queue.dequeue(provider, billingActorId, ticketId)
    }
  }

  /**
   * Block until our ticket reaches the head of the queue. Refreshes the heartbeat on a
   * regular cadence so we don't get reaped as dead. Returns `timedOut: true` if we exceed
   * `MAX_QUEUE_WAIT_MS` before reaching the head.
   *
   * No-op when Redis is unavailable (queue.enqueue returns enabled=false and checkHead
   * always returns 'head').
   */
  private async waitForQueueHead(
    provider: string,
    billingActorId: string,
    ticketId: string,
    startedAt: number
  ): Promise<{ timedOut: boolean }> {
    let lastHeartbeatAt = Date.now()

    while (true) {
      const status = await this.queue.checkHead(provider, billingActorId, ticketId)
      if (status === 'head') return { timedOut: false }

      // 'missing' shouldn't normally happen — queue list TTL is 10min and our cap is 5min —
      // but if it does (e.g. Redis flushed mid-wait), treat as "you're up" so the caller
      // proceeds to the bucket race rather than hanging forever.
      if (status === 'missing') return { timedOut: false }

      const elapsed = Date.now() - startedAt
      if (elapsed >= MAX_QUEUE_WAIT_MS) {
        return { timedOut: true }
      }

      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_REFRESH_INTERVAL_MS) {
        await this.queue.refreshHeartbeat(provider, billingActorId, ticketId)
        lastHeartbeatAt = Date.now()
      }

      await sleep(QUEUE_HEAD_POLL_MS)
    }
  }

  /**
   * Wait for actor request-rate capacity. Called once we're at the head of the FIFO
   * queue, so other callers can't race us for the next token — they're blocked behind us
   * at queue level. Re-checks the bucket up to the remaining `MAX_QUEUE_WAIT_MS` budget
   * (accounting for time already spent waiting in the queue).
   */
  private async waitForActorCapacity(
    provider: string,
    billingActorId: string,
    ticketId: string,
    config: HostedKeyRateLimitConfig,
    startedAt: number
  ): Promise<{ rateLimited: false } | { rateLimited: true; retryAfterMs: number }> {
    let lastHeartbeatAt = Date.now()

    while (true) {
      const result = await this.checkActorRateLimit(provider, billingActorId, config)
      if (!result) return { rateLimited: false }

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

      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_REFRESH_INTERVAL_MS) {
        await this.queue.refreshHeartbeat(provider, billingActorId, ticketId)
        lastHeartbeatAt = Date.now()
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
    ticketId: string,
    config: CustomRateLimit,
    startedAt: number
  ): Promise<
    { rateLimited: false } | { rateLimited: true; retryAfterMs: number; dimension: string }
  > {
    let lastHeartbeatAt = Date.now()

    while (true) {
      const result = await this.preCheckDimensions(provider, billingActorId, config)
      if (!result) return { rateLimited: false }

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

      if (Date.now() - lastHeartbeatAt >= HEARTBEAT_REFRESH_INTERVAL_MS) {
        await this.queue.refreshHeartbeat(provider, billingActorId, ticketId)
        lastHeartbeatAt = Date.now()
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
