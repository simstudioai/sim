import * as crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getRedisClient } from '@/lib/redis'
import { db } from '@/db'
import { idempotencyKey } from '@/db/schema'

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

  /**
   * Enable database fallback when Redis is not available
   * Default: true
   */
  enableDatabaseFallback?: boolean
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
   * Storage method used ('redis', 'database', 'memory')
   */
  storageMethod: 'redis' | 'database' | 'memory'
}

export interface ProcessingResult {
  success: boolean
  result?: any
  error?: string
}

const DEFAULT_TTL = 60 * 60 * 24 * 7 // 7 days
const REDIS_KEY_PREFIX = 'idempotency:'
const MEMORY_CACHE_SIZE = 1000

const memoryCache = new Map<
  string,
  {
    result: any
    timestamp: number
    ttl: number
  }
>()

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
      enableDatabaseFallback: config.enableDatabaseFallback ?? true,
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

    if (this.config.enableDatabaseFallback) {
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
        logger.warn(`Database idempotency check failed for ${normalizedKey}:`, error)
      }
    }

    const memoryEntry = memoryCache.get(normalizedKey)
    if (memoryEntry) {
      const isExpired = Date.now() - memoryEntry.timestamp > memoryEntry.ttl * 1000
      if (!isExpired) {
        logger.debug(`Idempotency hit in memory: ${normalizedKey}`)
        return {
          isFirstTime: false,
          normalizedKey,
          previousResult: memoryEntry.result,
          storageMethod: 'memory',
        }
      }
      memoryCache.delete(normalizedKey)
    }

    logger.debug(`Idempotency miss in memory: ${normalizedKey}`)
    return {
      isFirstTime: true,
      normalizedKey,
      storageMethod: 'memory',
    }
  }

  /**
   * Store the result of processing for future idempotency checks
   */
  async storeResult(
    normalizedKey: string,
    result: ProcessingResult,
    storageMethod: 'redis' | 'database' | 'memory'
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

    if (this.config.enableDatabaseFallback && storageMethod !== 'memory') {
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
        return
      } catch (error) {
        logger.warn(`Failed to store result in database for ${normalizedKey}:`, error)
      }
    }

    memoryCache.set(normalizedKey, {
      result,
      timestamp: Date.now(),
      ttl: this.config.ttlSeconds,
    })

    if (memoryCache.size > MEMORY_CACHE_SIZE) {
      const entries = Array.from(memoryCache.entries())
      const now = Date.now()

      entries.forEach(([key, entry]) => {
        if (now - entry.timestamp > entry.ttl * 1000) {
          memoryCache.delete(key)
        }
      })

      if (memoryCache.size > MEMORY_CACHE_SIZE) {
        const sortedEntries = entries
          .filter(([key]) => memoryCache.has(key))
          .sort((a, b) => a[1].timestamp - b[1].timestamp)

        const toRemove = sortedEntries.slice(0, memoryCache.size - MEMORY_CACHE_SIZE)
        toRemove.forEach(([key]) => memoryCache.delete(key))
      }
    }

    logger.debug(`Stored idempotency result in memory: ${normalizedKey}`)
  }

  /**
   * Execute an operation with idempotency protection
   */
  async executeWithIdempotency<T>(
    provider: string,
    identifier: string,
    operation: () => Promise<T>,
    additionalContext?: Record<string, any>
  ): Promise<T> {
    const idempotencyCheck = await this.checkIdempotency(provider, identifier, additionalContext)

    if (!idempotencyCheck.isFirstTime) {
      logger.info(`Skipping duplicate operation: ${idempotencyCheck.normalizedKey}`)

      if (idempotencyCheck.previousResult?.success === false) {
        throw new Error(idempotencyCheck.previousResult?.error || 'Previous operation failed')
      }

      return idempotencyCheck.previousResult?.result as T
    }

    try {
      logger.debug(`Executing new operation: ${idempotencyCheck.normalizedKey}`)
      const result = await operation()

      await this.storeResult(
        idempotencyCheck.normalizedKey,
        { success: true, result },
        idempotencyCheck.storageMethod
      )

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.storeResult(
        idempotencyCheck.normalizedKey,
        { success: false, error: errorMessage },
        idempotencyCheck.storageMethod
      )

      throw error
    }
  }

  /**
   * Create an idempotency key from a webhook payload
   */
  static createWebhookIdempotencyKey(
    webhookId: string,
    payload: any,
    headers?: Record<string, string>
  ): string {
    const webhookIdHeader =
      headers?.['x-webhook-id'] ||
      headers?.['x-shopify-webhook-id'] ||
      headers?.['x-github-delivery'] ||
      headers?.['stripe-signature']?.split(',')[0]

    if (webhookIdHeader) {
      return `${webhookId}:${webhookIdHeader}`
    }

    const payloadId = payload?.id || payload?.event_id || payload?.message?.id || payload?.data?.id

    if (payloadId) {
      return `${webhookId}:${payloadId}`
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
      .substring(0, 16)

    return `${webhookId}:${payloadHash}`
  }

  /**
   * Create an idempotency key for Gmail polling
   */
  static createGmailIdempotencyKey(webhookId: string, emailId: string): string {
    return `${webhookId}:${emailId}`
  }

  /**
   * Create an idempotency key for generic triggers
   */
  static createTriggerIdempotencyKey(
    triggerId: string,
    eventId: string,
    additionalContext?: Record<string, string>
  ): string {
    const base = `${triggerId}:${eventId}`
    if (additionalContext && Object.keys(additionalContext).length > 0) {
      const contextStr = Object.keys(additionalContext)
        .sort()
        .map((key) => `${key}=${additionalContext[key]}`)
        .join('&')
      return `${base}:${contextStr}`
    }
    return base
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

export const triggerIdempotency = new IdempotencyService({
  namespace: 'trigger',
  ttlSeconds: 60 * 60 * 24 * 1, // 1 day
})
