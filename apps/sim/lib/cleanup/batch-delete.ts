import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

const logger = createLogger('BatchDelete')

export const DEFAULT_BATCH_SIZE = 2000
export const DEFAULT_MAX_BATCHES_PER_TABLE = 10

export interface TableCleanupResult {
  table: string
  deleted: number
  failed: number
}

export interface BatchDeleteOptions {
  tableDef: PgTable
  workspaceIdCol: PgColumn
  timestampCol: PgColumn
  workspaceIds: string[]
  retentionDate: Date
  tableName: string
  /** When true, also requires `timestampCol IS NOT NULL` (soft-delete semantics). */
  requireTimestampNotNull?: boolean
  batchSize?: number
  maxBatches?: number
}

/**
 * Iteratively delete rows in a table matching a workspace + time-based predicate.
 *
 * Uses a SELECT-with-LIMIT → DELETE-by-ID pattern to keep each round bounded in
 * memory and I/O (PostgreSQL DELETE does not support LIMIT directly).
 */
export async function batchDeleteByWorkspaceAndTimestamp({
  tableDef,
  workspaceIdCol,
  timestampCol,
  workspaceIds,
  retentionDate,
  tableName,
  requireTimestampNotNull = false,
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = DEFAULT_MAX_BATCHES_PER_TABLE,
}: BatchDeleteOptions): Promise<TableCleanupResult> {
  const result: TableCleanupResult = { table: tableName, deleted: 0, failed: 0 }

  if (workspaceIds.length === 0) {
    logger.info(`[${tableName}] Skipped — no workspaces in scope`)
    return result
  }

  const predicates = [inArray(workspaceIdCol, workspaceIds), lt(timestampCol, retentionDate)]
  if (requireTimestampNotNull) predicates.push(isNotNull(timestampCol))
  const whereClause = and(...predicates)

  let batchesProcessed = 0
  let hasMore = true

  while (hasMore && batchesProcessed < maxBatches) {
    try {
      const batch = await db
        .select({ id: sql<string>`id` })
        .from(tableDef)
        .where(whereClause)
        .limit(batchSize)

      if (batch.length === 0) {
        logger.info(`[${tableName}] No expired rows found`)
        hasMore = false
        break
      }

      const ids = batch.map((r) => r.id)
      const deleted = await db
        .delete(tableDef)
        .where(inArray(sql`id`, ids))
        .returning({ id: sql`id` })

      result.deleted += deleted.length
      hasMore = batch.length === batchSize
      batchesProcessed++

      logger.info(`[${tableName}] Batch ${batchesProcessed}: deleted ${deleted.length} rows`)
    } catch (error) {
      result.failed++
      logger.error(`[${tableName}] Batch delete failed:`, { error })
      hasMore = false
    }
  }

  return result
}

/**
 * Delete rows by an explicit list of IDs. Use this when the IDs were selected
 * upstream (e.g., to drive external cleanup like S3 deletes or a backend API
 * call) so the DB delete cannot drift from the upstream selection. Paired with
 * `batchDeleteByWorkspaceAndTimestamp` for tables with no external side effects.
 */
export async function deleteRowsById(
  tableDef: PgTable,
  idCol: PgColumn,
  ids: string[],
  tableName: string
): Promise<TableCleanupResult> {
  const result: TableCleanupResult = { table: tableName, deleted: 0, failed: 0 }
  if (ids.length === 0) return result
  try {
    const deleted = await db.delete(tableDef).where(inArray(idCol, ids)).returning({ id: idCol })
    result.deleted = deleted.length
    logger.info(`[${tableName}] Deleted ${deleted.length} rows`)
  } catch (error) {
    result.failed++
    logger.error(`[${tableName}] Delete failed:`, { error })
  }
  return result
}
