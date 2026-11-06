import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, asc, gte, inArray, like, lt, notLike, sql } from 'drizzle-orm'

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

/** The namespace a key was claimed under: everything before its first `:`. */
function keyNamespace(key: string): string {
  const separator = key.indexOf(':')
  return separator > 0 ? key.slice(0, separator) : 'unknown'
}

/**
 * Clean up expired idempotency keys from the database, oldest first.
 *
 * Each batch resumes at the creation time the previous one ended on. The global sweep keeps the
 * permanent namespaces, whose expired rows stay at the front of the creation-time order forever,
 * so a batch that started from the beginning again would re-read all of them every time.
 */
export async function cleanupExpiredIdempotencyKeys(
  options: CleanupOptions = {}
): Promise<{ deleted: number; deletedByNamespace: Record<string, number>; errors: string[] }> {
  const {
    maxAgeSeconds = 7 * 24 * 60 * 60, // 7 days
    batchSize = 1000,
    namespace,
  } = options

  const errors: string[] = []
  const deletedByNamespace: Record<string, number> = {}
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
    let resumeAt: Date | undefined

    while (hasMore) {
      try {
        const expired = and(
          lt(idempotencyKey.createdAt, cutoffDate),
          resumeAt ? gte(idempotencyKey.createdAt, resumeAt) : undefined
        )
        const whereCondition = namespace
          ? and(expired, like(idempotencyKey.key, `${namespace}:%`))
          : and(
              expired,
              notLike(idempotencyKey.key, 'admin-credit-grant:%'),
              notLike(idempotencyKey.key, 'workflow-execution-id:%')
            )

        const toDelete = await db
          .select({ key: idempotencyKey.key, createdAt: idempotencyKey.createdAt })
          .from(idempotencyKey)
          .where(whereCondition)
          .orderBy(asc(idempotencyKey.createdAt))
          .limit(batchSize)

        if (toDelete.length === 0) {
          break
        }
        const deleteResult = await db
          .delete(idempotencyKey)
          .where(
            inArray(
              idempotencyKey.key,
              toDelete.map((item) => item.key)
            )
          )
          .returning({ key: idempotencyKey.key })

        resumeAt = toDelete[toDelete.length - 1].createdAt
        const deletedCount = deleteResult.length
        totalDeleted += deletedCount
        for (const { key } of deleteResult) {
          const keyPrefix = keyNamespace(key)
          deletedByNamespace[keyPrefix] = (deletedByNamespace[keyPrefix] ?? 0) + 1
        }
        batchCount++

        if (deletedCount === 0) {
          hasMore = false
          logger.info('No more expired idempotency keys found')
        } else if (deletedCount < batchSize) {
          hasMore = false
          logger.info(`Deleted final batch of ${deletedCount} expired idempotency keys`)
        } else {
          logger.info(`Deleted batch ${batchCount}: ${deletedCount} expired idempotency keys`)

          await sleep(100)
        }
      } catch (batchError) {
        const errorMessage = getErrorMessage(batchError, 'Unknown batch error')
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
      deletedByNamespace,
      batchCount,
      errors: errors.length,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error')
    logger.error('Failed to cleanup expired idempotency keys:', error)
    errors.push(`General error: ${errorMessage}`)
  }

  return { deleted: totalDeleted, deletedByNamespace, errors }
}

/**
 * The planner's row estimate for `idempotency_key`, refreshed by autovacuum and ANALYZE: one
 * catalog read, where an exact count is a scan of the whole table. Null when the table has never
 * been analyzed or the read fails.
 */
export async function estimateIdempotencyKeyCount(): Promise<number | null> {
  try {
    const [row] = await db.execute<{ estimate: number | string | null }>(
      sql`SELECT reltuples::bigint AS estimate FROM pg_class WHERE oid = to_regclass('idempotency_key')`
    )
    const estimate = Number(row?.estimate)
    return Number.isFinite(estimate) && estimate >= 0 ? estimate : null
  } catch (error) {
    logger.error('Failed to estimate idempotency key count:', error)
    return null
  }
}
