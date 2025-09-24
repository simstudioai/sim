import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'

const logger = createLogger('IdempotencyService')

export interface IdempotencyConfig {
  /**
   * Time-to-live for the idempotency key in seconds
   * Default: 7 days (604800 seconds)
   */
  ttlSeconds?: number

  /**
   * Namespace for the idempotency key (e.g., 'gmail', 'webhook', 'trigger')
   * Default: 'default'
   */
  namespace?: string
}

export interface IdempotencyResult {
  /**
   * Whether this is the first time processing this key
   */
  isFirstTime: boolean

  /**
   * The normalized idempotency key used for storage
   */
  normalizedKey: string

  /**
   * Previous result if this key was already processed
   */
  previousResult?: any

  /**
   * Storage method used ('redis', 'database')
   */
  storageMethod: 'redis' | 'database'
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
  storageMethod: 'redis' | 'database'
}

const DEFAULT_TTL = 60 * 60 * 24 * 7 // 7 days
const REDIS_KEY_PREFIX = 'idempotency:'
const MAX_WAIT_TIME_MS = 300000 // 5 minutes max wait for in-progress operations
const POLL_INTERVAL_MS = 1000 // Check every 1 second for completion

/**
 * Universal idempotency service for webhooks, triggers, and any other operations
 * that need duplicate prevention.
 */
export class IdempotencyService {
  private config: Required<IdempotencyConfig>

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL,
      namespace: config.namespace ?? 'default',
    }
  }

  /**
   * Generate a normalized idempotency key from various sources
   */
  private normalizeKey(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>
  ): string {
    const base = `${this.config.namespace}:${provider}:${identifier}`

    if (additionalContext && Object.keys(additionalContext).length > 0) {
      // Sort keys for consistent hashing
      const sortedKeys = Object.keys(additionalContext).sort()
      const contextStr = sortedKeys.map((key) => `${key}=${additionalContext[key]}`).join('&')
      return `${base}:${contextStr}`
    }

    return base
  }

  /**
   * Check if an operation has already been processed
   */
  async checkIdempotency(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>
  ): Promise<IdempotencyResult> {
    const normalizedKey = this.normalizeKey(provider, identifier, additionalContext)
    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`

    try {
      const redis = getRedisClient()
      if (redis) {
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
    } catch (error) {
      logger.warn(`Redis idempotency check failed for ${normalizedKey}:`, error)
    }

    // Always fallback to database when Redis is not available
    try {
      const existing = await db
        .select({ result: idempotencyKey.result, createdAt: idempotencyKey.createdAt })
        .from(idempotencyKey)
        .where(
          and(
            eq(idempotencyKey.key, normalizedKey),
            eq(idempotencyKey.namespace, this.config.namespace)
          )
        )
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
    } catch (error) {
      logger.error(`Database idempotency check failed for ${normalizedKey}:`, error)
      throw new Error(`Failed to check idempotency: database unavailable`)
    }
  }

  /**
   * Atomically claim an idempotency key for processing
   * Returns true if successfully claimed, false if already exists
   */
  async atomicallyClaim(
    provider: string,
    identifier: string,
    additionalContext?: Record<string, any>
  ): Promise<AtomicClaimResult> {
    const normalizedKey = this.normalizeKey(provider, identifier, additionalContext)
    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`
    const inProgressResult: ProcessingResult = {
      success: false,
      status: 'in-progress',
      startedAt: Date.now(),
    }

    try {
      const redis = getRedisClient()
      if (redis) {
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
    } catch (error) {
      logger.warn(`Redis atomic claim failed for ${normalizedKey}:`, error)
    }

    // Always fallback to database when Redis is not available
    try {
      const insertResult = await db
        .insert(idempotencyKey)
        .values({
          key: normalizedKey,
          namespace: this.config.namespace,
          result: inProgressResult,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
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
        .where(
          and(
            eq(idempotencyKey.key, normalizedKey),
            eq(idempotencyKey.namespace, this.config.namespace)
          )
        )
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
    } catch (error) {
      logger.error(`Database atomic claim failed for ${normalizedKey}:`, error)
      throw new Error(`Failed to claim idempotency key: database unavailable`)
    }
  }

  /**
   * Wait for an in-progress operation to complete and return its result
   */
  async waitForResult<T>(normalizedKey: string, storageMethod: 'redis' | 'database'): Promise<T> {
    const startTime = Date.now()
    const redisKey = `${REDIS_KEY_PREFIX}${normalizedKey}`

    while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
      try {
        let currentResult: ProcessingResult | null = null

        if (storageMethod === 'redis') {
          const redis = getRedisClient()
          if (redis) {
            const data = await redis.get(redisKey)
            currentResult = data ? JSON.parse(data) : null
          }
        } else if (storageMethod === 'database') {
          const existing = await db
            .select({ result: idempotencyKey.result })
            .from(idempotencyKey)
            .where(
              and(
                eq(idempotencyKey.key, normalizedKey),
                eq(idempotencyKey.namespace, this.config.namespace)
              )
            )
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
      } catch (error) {
        if (error instanceof Error && error.message.includes('operation failed')) {
          throw error
        }
        logger.warn(`Error while waiting for result ${normalizedKey}:`, error)
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }

    throw new Error(`Timeout waiting for idempotency operation to complete: ${normalizedKey}`)
  }

  /**
   * Store the result of processing for future idempotency checks
   */
  async storeResult(
    normalizedKey: string,
    result: ProcessingResult,
    storageMethod: 'redis' | 'database'
  ): Promise<void> {
    const serializedResult = JSON.stringify(result)

    try {
      if (storageMethod === 'redis') {
        const redis = getRedisClient()
        if (redis) {
          await redis.setex(
            `${REDIS_KEY_PREFIX}${normalizedKey}`,
            this.config.ttlSeconds,
            serializedResult
          )
          logger.debug(`Stored idempotency result in Redis: ${normalizedKey}`)
          return
        }
      }
    } catch (error) {
      logger.warn(`Failed to store result in Redis for ${normalizedKey}:`, error)
    }

    // Always fallback to database when Redis is not available
    try {
      await db
        .insert(idempotencyKey)
        .values({
          key: normalizedKey,
          namespace: this.config.namespace,
          result: result,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [idempotencyKey.key, idempotencyKey.namespace],
          set: {
            result: result,
            createdAt: new Date(),
          },
        })

      logger.debug(`Stored idempotency result in database: ${normalizedKey}`)
    } catch (error) {
      logger.error(`Failed to store result in database for ${normalizedKey}:`, error)
      throw new Error(`Failed to store idempotency result: database unavailable`)
    }
  }

  /**
   * Execute an operation with idempotency protection using atomic claims
   * Eliminates race conditions by claiming the key before execution
   */
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

      await this.storeResult(
        claimResult.normalizedKey,
        { success: false, error: errorMessage, status: 'failed' },
        claimResult.storageMethod
      )

      logger.warn(`Operation failed: ${claimResult.normalizedKey} - ${errorMessage}`)
      throw error
    }
  }

  /**
   * Create an idempotency key from a webhook payload following RFC best practices
   * Standard webhook headers (webhook-id, x-webhook-id, etc.)
   */
  static createWebhookIdempotencyKey(webhookId: string, headers?: Record<string, string>): string {
    const normalizedHeaders = headers
      ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
      : undefined

    const webhookIdHeader =
      normalizedHeaders?.['webhook-id'] ||
      normalizedHeaders?.['x-webhook-id'] ||
      normalizedHeaders?.['x-shopify-webhook-id'] ||
      normalizedHeaders?.['x-github-delivery'] ||
      normalizedHeaders?.['x-event-id']

    if (webhookIdHeader) {
      return `${webhookId}:${webhookIdHeader}`
    }

    const uniqueId = randomUUID()
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
})
