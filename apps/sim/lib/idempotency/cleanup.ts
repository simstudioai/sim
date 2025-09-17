import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { and, eq, lt } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'

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
   * Specific namespace to clean up, or undefined to clean all namespaces
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
        const whereCondition = namespace
          ? and(lt(idempotencyKey.createdAt, cutoffDate), eq(idempotencyKey.namespace, namespace))
          : lt(idempotencyKey.createdAt, cutoffDate)

        // First, find IDs to delete with limit
        const toDelete = await db
          .select({ key: idempotencyKey.key, namespace: idempotencyKey.namespace })
          .from(idempotencyKey)
          .where(whereCondition)
          .limit(batchSize)

        if (toDelete.length === 0) {
          break
        }

        // Delete the found records
        const deleteResult = await db
          .delete(idempotencyKey)
          .where(
            and(
              ...toDelete.map((item) =>
                and(eq(idempotencyKey.key, item.key), eq(idempotencyKey.namespace, item.namespace))
              )
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
 */
export async function getIdempotencyKeyStats(): Promise<{
  totalKeys: number
  keysByNamespace: Record<string, number>
  oldestKey: Date | null
  newestKey: Date | null
}> {
  try {
    const allKeys = await db
      .select({
        namespace: idempotencyKey.namespace,
        createdAt: idempotencyKey.createdAt,
      })
      .from(idempotencyKey)

    const totalKeys = allKeys.length
    const keysByNamespace: Record<string, number> = {}
    let oldestKey: Date | null = null
    let newestKey: Date | null = null

    for (const key of allKeys) {
      keysByNamespace[key.namespace] = (keysByNamespace[key.namespace] || 0) + 1

      if (!oldestKey || key.createdAt < oldestKey) {
        oldestKey = key.createdAt
      }
      if (!newestKey || key.createdAt > newestKey) {
        newestKey = key.createdAt
      }
    }

    return {
      totalKeys,
      keysByNamespace,
      oldestKey,
      newestKey,
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
