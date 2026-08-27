import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { isRetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'
import { extractProviderIdentifierFromBody } from '@/lib/webhooks/providers'

const logger = createLogger('IdempotencyService')

export interface IdempotencyConfig {
  ttlSeconds?: number
  /**
   * How long an unfinished atomic claim is considered live. Defaults to the
   * result TTL for backwards compatibility. Set this shorter for webhook
   * handlers so a process crash cannot poison the key beyond the provider's
   * retry window while completed results remain deduplicated for longer.
   */
  inProgressTtlSeconds?: number
  namespace?: string
  /** When true, failed keys are deleted rather than stored so the operation is retried on the next attempt. */
  retryFailures?: boolean
  /**
   * When false, only `{ success, status, error? }` is persisted — not the
   * operation's return value. Duplicate calls still short-circuit but
   * resolve to `undefined`. Use when callers don't consume the cached
   * body (e.g. webhook receivers, where the provider just wants a 2xx).
   * Defaults to true.
   */
  storeResultBody?: boolean
  /**
   * Force a specific storage backend regardless of the environment's
   * auto-detection. Use `'database'` for correctness-critical flows
   * (money, billing, compliance) where the claim + operation should
   * fate-share with the Postgres transaction — this closes the narrow
   * window where the operation commits to DB but `storeResult` to Redis
   * fails and the retry re-runs the operation. Latency cost is 1–5ms
   * per call, imperceptible on webhook code paths.
   *
   * Leave unset (or set `'redis'`) for latency-sensitive, high-volume
   * flows like app webhook triggers where the scale benefits of Redis
   * outweigh the narrow durability window.
   */
  forceStorage?: StorageMethod
}

export interface IdempotencyResult {
  isFirstTime: boolean
  normalizedKey: string
  previousResult?: any
  storageMethod: StorageMethod
}

export interface ProcessingResult {
  success: boolean
  result?: any
  error?: string
  status?: 'in-progress' | 'completed' | 'failed'
  startedAt?: number
  /** Absolute Unix epoch milliseconds when an unfinished holder may be reclaimed. */
  inProgressExpiresAt?: number
  /** Opaque fencing token owned by the process that holds an in-progress lease. */
  claimToken?: string
}

export interface IdempotencyExecutionOptions {
  /** Absolute Unix epoch milliseconds when this operation's in-progress claim becomes stale. */
  inProgressExpiresAt?: number
}

export interface AtomicClaimResult {
  claimed: boolean
  existingResult?: ProcessingResult
  normalizedKey: string
  storageMethod: StorageMethod
  /** Present only when this caller acquired the claim. Required to finalize or release it. */
  claimToken?: string
  /** Exact serialized value observed by Redis when another holder owns the key. */
  observedValue?: string
}

const DEFAULT_TTL = 60 * 60 * 24 * 7
const REDIS_KEY_PREFIX = 'idempotency:'
const MAX_WAIT_TIME_MS = getMaxExecutionTimeout()
const POLL_INTERVAL_MS = 1000

const CLAIM_REDIS_LEASE_SCRIPT = `
local claimed = redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]), 'NX')
if claimed then return {1, ''} end
local current = redis.call('GET', KEYS[1])
if current then return {0, current} end
claimed = redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]), 'NX')
if claimed then return {1, ''} end
current = redis.call('GET', KEYS[1])
return {0, current or ''}
`

const STORE_REDIS_RESULT_IF_OWNER_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.claimToken ~= ARGV[1] then return 0 end
redis.call('SETEX', KEYS[1], tonumber(ARGV[2]), ARGV[3])
return 1
`

const DELETE_REDIS_RESULT_IF_OWNER_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.claimToken ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

const DELETE_REDIS_RESULT_IF_VALUE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`

/**
 * Universal idempotency service for webhooks, triggers, and any other operations
 * that need duplicate prevention.
 *
 * Storage is determined once based on configuration:
 * - If `forceStorage` is set → that backend unconditionally
 * - Else use the provider selected by the cache capability
 */
export class IdempotencyService {
  private config: Required<Omit<IdempotencyConfig, 'forceStorage'>>
  private storageMethod: StorageMethod

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL,
      inProgressTtlSeconds: config.inProgressTtlSeconds ?? config.ttlSeconds ?? DEFAULT_TTL,
      namespace: config.namespace ?? 'default',
      retryFailures: config.retryFailures ?? false,
      storeResultBody: config.storeResultBody ?? true,
    }
    this.storageMethod = config.forceStorage ?? getStorageMethod()
    logger.info(`IdempotencyService using ${this.storageMethod} storage`, {
      namespace: this.config.namespace,
      forced: Boolean(config.forceStorage),
    })
  }

  private normalizeKey(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>
  ): string {
    const base = `${this.config.namespace}:${provider}:${identifier}`

    if (additionalContext && Object.keys(additionalContext).length > 0) {
      const sortedKeys = Object.keys(additionalContext).sort()
      const contextStr = sortedKeys.map((key) => `${key}=${additionalContext[key]}`).join('&')
      return `${base}:${contextStr}`
    }

    return base
  }

  async checkIdempotency(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>
  ): Promise<IdempotencyResult> {
    const normalizedKey = this.normalizeKey(provider, identifier, additionalContext)

    if (this.storageMethod === 'redis') {
      return this.checkIdempotencyRedis(normalizedKey)
    }
    return this.checkIdempotencyDb(normalizedKey)
  }

  private async checkIdempotencyRedis(normalizedKey: string): Promise<IdempotencyResult> {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis not available for idempotency check')
    }

    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`
    const cachedResult = await redis.get(redisKey)

    if (cachedResult) {
      logger.debug(`Idempotency hit in Redis: ${normalizedKey}`)
      return {
        isFirstTime: false,
        normalizedKey,
        previousResult: JSON.parse(cachedResult),
        storageMethod: 'redis',
      }
    }

    logger.debug(`Idempotency miss in Redis: ${normalizedKey}`)
    return {
      isFirstTime: true,
      normalizedKey,
      storageMethod: 'redis',
    }
  }

  private async checkIdempotencyDb(normalizedKey: string): Promise<IdempotencyResult> {
    const existing = await db
      .select({ result: idempotencyKey.result, createdAt: idempotencyKey.createdAt })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, normalizedKey))
      .limit(1)

    if (existing.length > 0) {
      const item = existing[0]
      const isExpired = Date.now() - item.createdAt.getTime() > this.config.ttlSeconds * 1000

      if (!isExpired) {
        logger.debug(`Idempotency hit in database: ${normalizedKey}`)
        return {
          isFirstTime: false,
          normalizedKey,
          previousResult: item.result,
          storageMethod: 'database',
        }
      }

      await db
        .delete(idempotencyKey)
        .where(eq(idempotencyKey.key, normalizedKey))
        .catch((err) => logger.warn(`Failed to clean up expired key ${normalizedKey}:`, err))
    }

    logger.debug(`Idempotency miss in database: ${normalizedKey}`)
    return {
      isFirstTime: true,
      normalizedKey,
      storageMethod: 'database',
    }
  }

  async atomicallyClaim(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>,
    options?: IdempotencyExecutionOptions
  ): Promise<AtomicClaimResult> {
    const normalizedKey = this.normalizeKey(provider, identifier, additionalContext)
    const now = Date.now()
    const inProgressExpiresAt =
      options?.inProgressExpiresAt &&
      Number.isFinite(options.inProgressExpiresAt) &&
      options.inProgressExpiresAt > now
        ? Math.floor(options.inProgressExpiresAt)
        : now + this.config.inProgressTtlSeconds * 1000
    const inProgressResult: ProcessingResult = {
      success: false,
      status: 'in-progress',
      startedAt: now,
      inProgressExpiresAt,
      claimToken: generateId(),
    }

    if (this.storageMethod === 'redis') {
      return this.atomicallyClaimRedis(normalizedKey, inProgressResult)
    }
    return this.atomicallyClaimDb(normalizedKey, inProgressResult)
  }

  private async atomicallyClaimRedis(
    normalizedKey: string,
    inProgressResult: ProcessingResult
  ): Promise<AtomicClaimResult> {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis not available for atomic claim')
    }

    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`
    const inProgressTtlSeconds = Math.max(
      1,
      Math.ceil(((inProgressResult.inProgressExpiresAt ?? Date.now()) - Date.now()) / 1000)
    )
    const claimResponse = await redis.eval(
      CLAIM_REDIS_LEASE_SCRIPT,
      1,
      redisKey,
      JSON.stringify(inProgressResult),
      inProgressTtlSeconds
    )
    if (!Array.isArray(claimResponse) || claimResponse.length < 2) {
      throw new Error(`Redis idempotency claim returned an invalid result: ${normalizedKey}`)
    }
    const claimed = Number(claimResponse[0]) === 1

    if (claimed) {
      logger.debug(`Atomically claimed idempotency key in Redis: ${normalizedKey}`)
      return {
        claimed: true,
        normalizedKey,
        storageMethod: 'redis',
        claimToken: inProgressResult.claimToken,
      }
    }

    const existingData = typeof claimResponse[1] === 'string' ? claimResponse[1] : ''
    if (!existingData) {
      throw new Error(`Redis idempotency claim race did not return an owner: ${normalizedKey}`)
    }
    const existingResult = existingData ? JSON.parse(existingData) : null
    logger.debug(`Idempotency key already claimed in Redis: ${normalizedKey}`)
    return {
      claimed: false,
      existingResult,
      normalizedKey,
      storageMethod: 'redis',
      observedValue: existingData,
    }
  }

  private async atomicallyClaimDb(
    normalizedKey: string,
    inProgressResult: ProcessingResult
  ): Promise<AtomicClaimResult> {
    const now = new Date()
    const expiredBefore = new Date(now.getTime() - this.config.ttlSeconds * 1000)
    const inProgressClaimExpired = sql`COALESCE(
      CASE
        WHEN json_typeof(${idempotencyKey.result} -> 'inProgressExpiresAt') = 'number'
          THEN (${idempotencyKey.result} ->> 'inProgressExpiresAt')::double precision
      END,
      EXTRACT(EPOCH FROM ${idempotencyKey.createdAt}) * 1000 + ${this.config.inProgressTtlSeconds * 1000}
    ) <= ${now.getTime()}`

    // `ON CONFLICT DO UPDATE` steals a completed/failed row only after the
    // normal result TTL, but reclaims a crashed `in-progress` holder after the
    // shorter processing lease. RETURNING yields a row in two cases:
    //   (1) fresh INSERT — no prior row existed;
    //   (2) UPDATE of an expired row — WHERE matched.
    // An empty RETURNING means conflict with an unexpired row; the
    // existing holder is still live and we must not steal.
    const insertResult = await db
      .insert(idempotencyKey)
      .values({
        key: normalizedKey,
        result: inProgressResult,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [idempotencyKey.key],
        set: {
          result: inProgressResult,
          createdAt: now,
        },
        setWhere: or(
          and(
            sql`${idempotencyKey.result} ->> 'status' IS DISTINCT FROM 'in-progress'`,
            lt(idempotencyKey.createdAt, expiredBefore)
          ),
          and(sql`${idempotencyKey.result} ->> 'status' = 'in-progress'`, inProgressClaimExpired)
        ),
      })
      .returning({ key: idempotencyKey.key })

    if (insertResult.length > 0) {
      logger.debug(`Atomically claimed idempotency key in database: ${normalizedKey}`)
      return {
        claimed: true,
        normalizedKey,
        storageMethod: 'database',
        claimToken: inProgressResult.claimToken,
      }
    }

    const existing = await db
      .select({ result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, normalizedKey))
      .limit(1)

    const existingResult =
      existing.length > 0 ? (existing[0].result as ProcessingResult) : undefined
    logger.debug(`Idempotency key already claimed in database: ${normalizedKey}`)
    return {
      claimed: false,
      existingResult,
      normalizedKey,
      storageMethod: 'database',
    }
  }

  async waitForResult<T>(
    normalizedKey: string,
    storageMethod: 'redis' | 'database',
    waitUntil = Date.now() + MAX_WAIT_TIME_MS
  ): Promise<T> {
    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`

    while (Date.now() < waitUntil) {
      let currentResult: ProcessingResult | null = null

      if (storageMethod === 'redis') {
        const redis = getRedisClient()
        if (!redis) {
          throw new Error('Redis not available')
        }
        const data = await redis.get(redisKey)
        currentResult = data ? JSON.parse(data) : null
      } else {
        const existing = await db
          .select({ result: idempotencyKey.result })
          .from(idempotencyKey)
          .where(eq(idempotencyKey.key, normalizedKey))
          .limit(1)
        currentResult = existing.length > 0 ? (existing[0].result as ProcessingResult) : null
      }

      if (currentResult?.status === 'completed') {
        logger.debug(`Operation completed, returning result: ${normalizedKey}`)
        if (currentResult.success === false) {
          throw new Error(currentResult.error || 'Previous operation failed')
        }
        return currentResult.result as T
      }

      if (currentResult?.status === 'failed') {
        logger.debug(`Operation failed, throwing error: ${normalizedKey}`)
        throw new Error(currentResult.error || 'Previous operation failed')
      }

      await sleep(POLL_INTERVAL_MS)
    }

    throw new Error(`Timeout waiting for idempotency operation to complete: ${normalizedKey}`)
  }

  async storeResult(
    normalizedKey: string,
    result: ProcessingResult,
    storageMethod: 'redis' | 'database',
    claimToken: string
  ): Promise<boolean> {
    if (storageMethod === 'redis') {
      return this.storeResultRedis(normalizedKey, result, claimToken)
    }
    return this.storeResultDb(normalizedKey, result, claimToken)
  }

  private async storeResultRedis(
    normalizedKey: string,
    result: ProcessingResult,
    claimToken: string
  ): Promise<boolean> {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis not available for storing result')
    }

    const storedResult = { ...result, claimToken }
    const stored = await redis.eval(
      STORE_REDIS_RESULT_IF_OWNER_SCRIPT,
      1,
      `${REDIS_KEY_PREFIX}${normalizedKey}`,
      claimToken,
      this.config.ttlSeconds,
      JSON.stringify(storedResult)
    )
    if (Number(stored) !== 1) {
      logger.warn(`Skipped stale idempotency result in Redis: ${normalizedKey}`)
      return false
    }
    logger.debug(`Stored idempotency result in Redis: ${normalizedKey}`)
    return true
  }

  private async storeResultDb(
    normalizedKey: string,
    result: ProcessingResult,
    claimToken: string
  ): Promise<boolean> {
    const storedResult = { ...result, claimToken }
    const [stored] = await db
      .update(idempotencyKey)
      .set({ result: storedResult, createdAt: new Date() })
      .where(
        and(
          eq(idempotencyKey.key, normalizedKey),
          sql`${idempotencyKey.result} ->> 'claimToken' = ${claimToken}`
        )
      )
      .returning({ key: idempotencyKey.key })

    if (!stored) {
      logger.warn(`Skipped stale idempotency result in database: ${normalizedKey}`)
      return false
    }
    logger.debug(`Stored idempotency result in database: ${normalizedKey}`)
    return true
  }

  async release(
    normalizedKey: string,
    storageMethod: 'redis' | 'database',
    claimToken?: string
  ): Promise<void> {
    await this.deleteKey(normalizedKey, storageMethod, claimToken ? { claimToken } : undefined)
  }

  private async deleteKey(
    normalizedKey: string,
    storageMethod: 'redis' | 'database',
    fence?: {
      claimToken?: string
      observedResult?: ProcessingResult
      observedValue?: string
    }
  ): Promise<boolean> {
    if (storageMethod === 'redis') {
      const redis = getRedisClient()
      if (!redis) return false
      if (fence?.claimToken) {
        const deleted = await redis.eval(
          DELETE_REDIS_RESULT_IF_OWNER_SCRIPT,
          1,
          `${REDIS_KEY_PREFIX}${normalizedKey}`,
          fence.claimToken
        )
        return Number(deleted) === 1
      }
      if (fence?.observedValue) {
        const deleted = await redis.eval(
          DELETE_REDIS_RESULT_IF_VALUE_SCRIPT,
          1,
          `${REDIS_KEY_PREFIX}${normalizedKey}`,
          fence.observedValue
        )
        return Number(deleted) === 1
      }
      return Number(await redis.del(`${REDIS_KEY_PREFIX}${normalizedKey}`)) > 0
    }

    const condition = fence?.claimToken
      ? and(
          eq(idempotencyKey.key, normalizedKey),
          sql`${idempotencyKey.result} ->> 'claimToken' = ${fence.claimToken}`
        )
      : fence?.observedResult
        ? and(
            eq(idempotencyKey.key, normalizedKey),
            sql`${idempotencyKey.result}::jsonb = ${JSON.stringify(fence.observedResult)}::jsonb`
          )
        : eq(idempotencyKey.key, normalizedKey)
    const deleted = await db
      .delete(idempotencyKey)
      .where(condition)
      .returning({ key: idempotencyKey.key })
    return deleted.length > 0
  }

  async executeWithIdempotency<T>(
    provider: string,
    identifier: string,
    operation: () => Promise<T>,
    additionalContext?: Record<string, any>,
    options?: IdempotencyExecutionOptions
  ): Promise<T> {
    const claimResult = await this.atomicallyClaim(provider, identifier, additionalContext, options)

    if (!claimResult.claimed) {
      const existingResult = claimResult.existingResult

      if (existingResult?.status === 'completed') {
        logger.info(`Returning cached result for: ${claimResult.normalizedKey}`)
        if (existingResult.success === false) {
          throw new Error(existingResult.error || 'Previous operation failed')
        }
        return existingResult.result as T
      }

      if (existingResult?.status === 'failed') {
        if (this.config.retryFailures) {
          await this.deleteKey(claimResult.normalizedKey, claimResult.storageMethod, {
            observedResult: existingResult,
            observedValue: claimResult.observedValue,
          })
          return this.executeWithIdempotency(
            provider,
            identifier,
            operation,
            additionalContext,
            options
          )
        }
        logger.info(`Previous operation failed for: ${claimResult.normalizedKey}`)
        throw new Error(existingResult.error || 'Previous operation failed')
      }

      if (existingResult?.status === 'in-progress') {
        logger.info(`Waiting for in-progress operation: ${claimResult.normalizedKey}`)
        return await this.waitForResult<T>(
          claimResult.normalizedKey,
          claimResult.storageMethod,
          existingResult.inProgressExpiresAt ??
            (existingResult.startedAt ?? Date.now()) + this.config.inProgressTtlSeconds * 1000
        )
      }

      if (existingResult) {
        return existingResult.result as T
      }

      throw new Error(`Unexpected state: key claimed but no existing result found`)
    }

    try {
      logger.info(`Executing new operation: ${claimResult.normalizedKey}`)
      const result = await operation()
      const claimToken = claimResult.claimToken
      if (!claimToken) throw new Error('Idempotency claim is missing its fencing token')

      await this.storeResult(
        claimResult.normalizedKey,
        this.config.storeResultBody
          ? { success: true, result, status: 'completed' }
          : { success: true, status: 'completed' },
        claimResult.storageMethod,
        claimToken
      )

      logger.debug(`Successfully completed operation: ${claimResult.normalizedKey}`)
      return result
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error')

      /**
       * A `RetryableSetupError` certifies the operation failed before any
       * effect happened, so there is no outcome to memoize: release the claim
       * so a re-attempt or provider redelivery can run instead of being
       * rejected with the cached failure for the whole result TTL.
       */
      if (this.config.retryFailures || isRetryableSetupError(error)) {
        await this.deleteKey(
          claimResult.normalizedKey,
          claimResult.storageMethod,
          claimResult.claimToken ? { claimToken: claimResult.claimToken } : undefined
        )
      } else {
        const claimToken = claimResult.claimToken
        if (!claimToken) throw new Error('Idempotency claim is missing its fencing token')
        await this.storeResult(
          claimResult.normalizedKey,
          { success: false, error: errorMessage, status: 'failed' },
          claimResult.storageMethod,
          claimToken
        )
      }

      logger.warn(`Operation failed: ${claimResult.normalizedKey} - ${errorMessage}`)
      throw error
    }
  }

  static createWebhookIdempotencyKey(
    webhookId: string,
    headers?: Record<string, string>,
    body?: any,
    provider?: string
  ): string {
    const normalizedHeaders = headers
      ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
      : undefined

    const webhookIdHeader =
      normalizedHeaders?.['x-sim-idempotency-key'] ||
      normalizedHeaders?.['webhook-id'] ||
      normalizedHeaders?.['x-webhook-id'] ||
      normalizedHeaders?.['x-shopify-webhook-id'] ||
      normalizedHeaders?.['x-github-delivery'] ||
      normalizedHeaders?.['x-gitlab-event-uuid'] ||
      normalizedHeaders?.['x-event-id'] ||
      normalizedHeaders?.['x-teams-notification-id'] ||
      normalizedHeaders?.['svix-id'] ||
      normalizedHeaders?.['linear-delivery'] ||
      normalizedHeaders?.['greenhouse-event-id'] ||
      normalizedHeaders?.['x-zm-request-id'] ||
      normalizedHeaders?.['x-atlassian-webhook-identifier'] ||
      normalizedHeaders?.['idempotency-key']

    if (webhookIdHeader) {
      return `${webhookId}:${webhookIdHeader}`
    }

    if (body && provider) {
      const bodyIdentifier = extractProviderIdentifierFromBody(provider, body)
      if (bodyIdentifier) {
        return `${webhookId}:${bodyIdentifier}`
      }
    }

    const uniqueId = generateId()
    logger.warn('No unique identifier found, duplicate executions may occur', {
      webhookId,
      provider,
    })
    return `${webhookId}:${uniqueId}`
  }
}

/**
 * Longest an unfinished webhook claim stays live when its caller cannot name a
 * real execution deadline.
 *
 * The lease only has to outlive a normal run; it must not outlive the process
 * holding it. Untimed executions have no deadline to borrow — `getExecutionDeadlineAt`
 * returns `undefined` for them — so before this bound existed they fell through
 * to the result TTL, which is the seven-day *dedupe* window. One crashed holder
 * therefore wedged a webhook for a week while every concurrent duplicate delivery
 * polled {@link IdempotencyService.waitForResult} once a second against it.
 *
 * Two hours clears the 90-minute default async execution budget plus the
 * reservation buffer with room to spare. A run that genuinely outlives it may be
 * executed a second time if the provider retries after the lease lapses — a
 * bounded, recoverable duplicate rather than an unbounded stall.
 */
export const WEBHOOK_IN_PROGRESS_LEASE_SECONDS = 60 * 60 * 2

/**
 * As a webhook receiver we only need a "we saw this delivery" marker —
 * the provider's retry just needs a 2xx, not our cached response body.
 * TTL must exceed the longest provider retry window (Gmail / Pub-Sub: 7d).
 *
 * The in-progress lease is deliberately far shorter than that dedupe window:
 * see {@link WEBHOOK_IN_PROGRESS_LEASE_SECONDS}.
 */
export const webhookIdempotency = new IdempotencyService({
  namespace: 'webhook',
  ttlSeconds: 60 * 60 * 24 * 7, // 7 days
  inProgressTtlSeconds: WEBHOOK_IN_PROGRESS_LEASE_SECONDS,
  storeResultBody: false,
})

export const pollingIdempotency = new IdempotencyService({
  namespace: 'polling',
  ttlSeconds: 60 * 60 * 24 * 3, // 3 days
  retryFailures: true,
  storeResultBody: false,
})

/**
 * Dedupes a chat send by its client-generated `userMessageId`, so re-sending
 * one is safe.
 *
 * The client cannot tell whether a request it aborted reached the server: the
 * chat route never reads `request.signal`, so an accepted request creates the
 * chat, persists the user message, and runs the (billed) turn even after the
 * browser drops the socket. Without this, a client that recovers an aborted
 * send has to choose between losing the message and duplicating the run.
 *
 * Storage is forced to Postgres for the same reason Stripe webhook claims are
 * (see `stripeWebhookIdempotency`): a missed deduplication is a second LLM turn
 * billed to the workspace, so the key must not be evictable under Redis memory
 * pressure. The added 1-5ms is invisible next to the LLM call that follows.
 *
 * `inProgressTtlSeconds` is short so a crashed pod cannot block a genuine retry
 * for the full hour, while completed sends stay deduplicated for it.
 */
export const chatSendIdempotency = new IdempotencyService({
  namespace: 'chat-send',
  ttlSeconds: 60 * 60, // 1 hour
  inProgressTtlSeconds: 60,
  forceStorage: 'database',
})
