import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getRedisClient } from '@/lib/core/config/redis'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getStorageMethod, type StorageMethod } from '@/lib/core/storage'
import { generateId } from '@/lib/core/utils/uuid'
import { extractProviderIdentifierFromBody } from '@/lib/webhooks/providers'

const logger = createLogger('IdempotencyService')

export interface IdempotencyConfig {
  ttlSeconds?: number
  namespace?: string
  /** When true, failed keys are deleted rather than stored so the operation is retried on the next attempt. */
  retryFailures?: boolean
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
}

export interface AtomicClaimResult {
  claimed: boolean
  existingResult?: ProcessingResult
  normalizedKey: string
  storageMethod: StorageMethod
}

const DEFAULT_TTL = 60 * 60 * 24 * 7
const REDIS_KEY_PREFIX = 'idempotency:'
const MAX_WAIT_TIME_MS = getMaxExecutionTimeout()
const POLL_INTERVAL_MS = 1000

/**
 * Universal idempotency service for webhooks, triggers, and any other operations
 * that need duplicate prevention.
 *
 * Storage is determined once based on configuration:
 * - If REDIS_URL is set → Redis
 * - If REDIS_URL is not set → PostgreSQL
 */
export class IdempotencyService {
  private config: Required<IdempotencyConfig>
  private storageMethod: StorageMethod

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL,
      namespace: config.namespace ?? 'default',
      retryFailures: config.retryFailures ?? false,
    }
    this.storageMethod = getStorageMethod()
    logger.info(`IdempotencyService using ${this.storageMethod} storage`, {
      namespace: this.config.namespace,
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
    additionalContext?: Record<string, any>
  ): Promise<AtomicClaimResult> {
    const normalizedKey = this.normalizeKey(provider, identifier, additionalContext)
    const inProgressResult: ProcessingResult = {
      success: false,
      status: 'in-progress',
      startedAt: Date.now(),
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
    const claimed = await redis.set(
      redisKey,
      JSON.stringify(inProgressResult),
      'EX',
      this.config.ttlSeconds,
      'NX'
    )

    if (claimed === 'OK') {
      logger.debug(`Atomically claimed idempotency key in Redis: ${normalizedKey}`)
      return {
        claimed: true,
        normalizedKey,
        storageMethod: 'redis',
      }
    }

    const existingData = await redis.get(redisKey)
    const existingResult = existingData ? JSON.parse(existingData) : null
    logger.debug(`Idempotency key already claimed in Redis: ${normalizedKey}`)
    return {
      claimed: false,
      existingResult,
      normalizedKey,
      storageMethod: 'redis',
    }
  }

  private async atomicallyClaimDb(
    normalizedKey: string,
    inProgressResult: ProcessingResult
  ): Promise<AtomicClaimResult> {
    const insertResult = await db
      .insert(idempotencyKey)
      .values({
        key: normalizedKey,
        result: inProgressResult,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [idempotencyKey.key],
      })
      .returning({ key: idempotencyKey.key })

    if (insertResult.length > 0) {
      logger.debug(`Atomically claimed idempotency key in database: ${normalizedKey}`)
      return {
        claimed: true,
        normalizedKey,
        storageMethod: 'database',
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

  async waitForResult<T>(normalizedKey: string, storageMethod: 'redis' | 'database'): Promise<T> {
    const startTime = Date.now()
    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`

    while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
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

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    throw new Error(`Timeout waiting for idempotency operation to complete: ${normalizedKey}`)
  }

  async storeResult(
    normalizedKey: string,
    result: ProcessingResult,
    storageMethod: 'redis' | 'database'
  ): Promise<void> {
    if (storageMethod === 'redis') {
      return this.storeResultRedis(normalizedKey, result)
    }
    return this.storeResultDb(normalizedKey, result)
  }

  private async storeResultRedis(normalizedKey: string, result: ProcessingResult): Promise<void> {
    const redis = getRedisClient()
    if (!redis) {
      throw new Error('Redis not available for storing result')
    }

    await redis.setex(
      `${REDIS_KEY_PREFIX}${normalizedKey}`,
      this.config.ttlSeconds,
      JSON.stringify(result)
    )
    logger.debug(`Stored idempotency result in Redis: ${normalizedKey}`)
  }

  private async storeResultDb(normalizedKey: string, result: ProcessingResult): Promise<void> {
    await db
      .insert(idempotencyKey)
      .values({
        key: normalizedKey,
        result: result,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [idempotencyKey.key],
        set: {
          result: result,
          createdAt: new Date(),
        },
      })

    logger.debug(`Stored idempotency result in database: ${normalizedKey}`)
  }

  private async deleteKey(
    normalizedKey: string,
    storageMethod: 'redis' | 'database'
  ): Promise<void> {
    if (storageMethod === 'redis') {
      const redis = getRedisClient()
      if (redis) await redis.del(`${REDIS_KEY_PREFIX}${normalizedKey}`).catch(() => {})
    } else {
      await db
        .delete(idempotencyKey)
        .where(eq(idempotencyKey.key, normalizedKey))
        .catch(() => {})
    }
  }

  async executeWithIdempotency<T>(
    provider: string,
    identifier: string,
    operation: () => Promise<T>,
    additionalContext?: Record<string, any>
  ): Promise<T> {
    const claimResult = await this.atomicallyClaim(provider, identifier, additionalContext)

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
          await this.deleteKey(claimResult.normalizedKey, claimResult.storageMethod)
          return this.executeWithIdempotency(provider, identifier, operation, additionalContext)
        }
        logger.info(`Previous operation failed for: ${claimResult.normalizedKey}`)
        throw new Error(existingResult.error || 'Previous operation failed')
      }

      if (existingResult?.status === 'in-progress') {
        logger.info(`Waiting for in-progress operation: ${claimResult.normalizedKey}`)
        return await this.waitForResult<T>(claimResult.normalizedKey, claimResult.storageMethod)
      }

      if (existingResult) {
        return existingResult.result as T
      }

      throw new Error(`Unexpected state: key claimed but no existing result found`)
    }

    try {
      logger.info(`Executing new operation: ${claimResult.normalizedKey}`)
      const result = await operation()

      await this.storeResult(
        claimResult.normalizedKey,
        { success: true, result, status: 'completed' },
        claimResult.storageMethod
      )

      logger.debug(`Successfully completed operation: ${claimResult.normalizedKey}`)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      if (this.config.retryFailures) {
        await this.deleteKey(claimResult.normalizedKey, claimResult.storageMethod)
      } else {
        await this.storeResult(
          claimResult.normalizedKey,
          { success: false, error: errorMessage, status: 'failed' },
          claimResult.storageMethod
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
      normalizedHeaders?.['x-event-id'] ||
      normalizedHeaders?.['x-teams-notification-id'] ||
      normalizedHeaders?.['svix-id'] ||
      normalizedHeaders?.['linear-delivery'] ||
      normalizedHeaders?.['greenhouse-event-id'] ||
      normalizedHeaders?.['x-zm-request-id'] ||
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

export const webhookIdempotency = new IdempotencyService({
  namespace: 'webhook',
  ttlSeconds: 60 * 60 * 24 * 7, // 7 days
})

export const pollingIdempotency = new IdempotencyService({
  namespace: 'polling',
  ttlSeconds: 60 * 60 * 24 * 3, // 3 days
  retryFailures: true,
})
