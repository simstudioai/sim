import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, inArray, like, lt, max, min, sql } from 'drizzle-orm'

const logger = createLogger('IdempotencyCleanup')

export interface CleanupOptions {
  /**
   * Maximum age of idempotency keys in seconds before they're considered expired
   * Default: 7 days (604800 seconds)
   */
  maxAgeSeconds?: number

  /**
   * Maximum number of keys to delete in a single batch
   * Default: 1000
   */
  batchSize?: number

  /**
   * Specific namespace prefix to clean up (e.g., 'webhook', 'polling')
   * Keys are prefixed with namespace, so this filters by key prefix
   */
  namespace?: string
}

/**
 * Clean up expired idempotency keys from the database
 */
export async function cleanupExpiredIdempotencyKeys(
  options: CleanupOptions = {}
): Promise<{ deleted: number; errors: string[] }> {
  const {
    maxAgeSeconds = 7 * 24 * 60 * 60, // 7 days
    batchSize = 1000,
    namespace,
  } = options

  const errors: string[] = []
  let totalDeleted = 0

  try {
    const cutoffDate = new Date(Date.now() - maxAgeSeconds * 1000)

    logger.info('Starting idempotency key cleanup', {
      cutoffDate: cutoffDate.toISOString(),
      namespace: namespace || 'all',
      batchSize,
    })

    let hasMore = true
    let batchCount = 0

    while (hasMore) {
      try {
        // Build where condition - filter by cutoff date and optionally by namespace prefix
        const whereCondition = namespace
          ? and(
              lt(idempotencyKey.createdAt, cutoffDate),
              like(idempotencyKey.key, `${namespace}:%`)
            )
          : lt(idempotencyKey.createdAt, cutoffDate)

        // Find keys to delete with limit
        const toDelete = await db
          .select({ key: idempotencyKey.key })
          .from(idempotencyKey)
          .where(whereCondition)
          .limit(batchSize)

        if (toDelete.length === 0) {
          break
        }

        // Delete the found records by key
        const deleteResult = await db
          .delete(idempotencyKey)
          .where(
            inArray(
              idempotencyKey.key,
              toDelete.map((item) => item.key)
            )
          )
          .returning({ key: idempotencyKey.key })

        const deletedCount = deleteResult.length
        totalDeleted += deletedCount
        batchCount++

        if (deletedCount === 0) {
          hasMore = false
          logger.info('No more expired idempotency keys found')
        } else if (deletedCount < batchSize) {
          hasMore = false
          logger.info(`Deleted final batch of ${deletedCount} expired idempotency keys`)
        } else {
          logger.info(`Deleted batch ${batchCount}: ${deletedCount} expired idempotency keys`)

          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } catch (batchError) {
        const errorMessage =
          batchError instanceof Error ? batchError.message : 'Unknown batch error'
        logger.error(`Error deleting batch ${batchCount + 1}:`, batchError)
        errors.push(`Batch ${batchCount + 1}: ${errorMessage}`)

        batchCount++

        if (errors.length > 5) {
          logger.error('Too many batch errors, stopping cleanup')
          break
        }
      }
    }

    logger.info('Idempotency key cleanup completed', {
      totalDeleted,
      batchCount,
      errors: errors.length,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to cleanup expired idempotency keys:', error)
    errors.push(`General error: ${errorMessage}`)
  }

  return { deleted: totalDeleted, errors }
}

/**
 * Get statistics about idempotency key usage
 * Uses SQL aggregations to avoid loading all keys into memory
 */
export async function getIdempotencyKeyStats(): Promise<{
  totalKeys: number
  keysByNamespace: Record<string, number>
  oldestKey: Date | null
  newestKey: Date | null
}> {
  try {
    // Get total count and date range in a single query
    const [statsResult] = await db
      .select({
        totalKeys: count(),
        oldestKey: min(idempotencyKey.createdAt),
        newestKey: max(idempotencyKey.createdAt),
      })
      .from(idempotencyKey)

    // Get counts by namespace prefix using SQL substring
    // Extracts everything before the first ':' as the namespace
    const namespaceStats = await db
      .select({
        namespace: sql<string>`split_part(${idempotencyKey.key}, ':', 1)`.as('namespace'),
        count: count(),
      })
      .from(idempotencyKey)
      .groupBy(sql`split_part(${idempotencyKey.key}, ':', 1)`)

    const keysByNamespace: Record<string, number> = {}
    for (const row of namespaceStats) {
      keysByNamespace[row.namespace || 'unknown'] = row.count
    }

    return {
      totalKeys: statsResult?.totalKeys ?? 0,
      keysByNamespace,
      oldestKey: statsResult?.oldestKey ?? null,
      newestKey: statsResult?.newestKey ?? null,
    }
  } catch (error) {
    logger.error('Failed to get idempotency key stats:', error)
    return {
      totalKeys: 0,
      keysByNamespace: {},
      oldestKey: null,
      newestKey: null,
    }
  }
}
