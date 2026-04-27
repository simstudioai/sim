import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

const logger = createLogger('BatchDelete')

export const DEFAULT_BATCH_SIZE = 2000
export const DEFAULT_MAX_BATCHES_PER_TABLE = 10
/**
 * Split workspaceIds into this-sized groups before running SELECT/DELETE. Large
 * IN lists combined with `started_at < X` force Postgres to probe every
 * workspace range in the composite index, which blows the 90s statement timeout
 * at the scale of the full free tier.
 */
export const DEFAULT_WORKSPACE_CHUNK_SIZE = 50

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export interface SelectByIdChunksOptions {
  /** Cap on rows returned across all chunks. Defaults to a full per-table cleanup budget. */
  overallLimit?: number
  chunkSize?: number
}

/**
 * Run a SELECT query once per ID chunk and concatenate results up to
 * `overallLimit`. Each chunk's query is passed the remaining row budget so the
 * total never exceeds the cap. Use this when you need the selected row set
 * (e.g. to drive S3 or copilot-backend cleanup alongside the DB delete).
 *
 * Works for any large ID set — workspace IDs, workflow IDs, etc. Avoids
 * sending one massive `IN (...)` list that would blow Postgres's statement
 * timeout.
 */
export async function selectRowsByIdChunks<T>(
  ids: string[],
  query: (chunkIds: string[], chunkLimit: number) => Promise<T[]>,
  {
    overallLimit = DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE,
    chunkSize = DEFAULT_WORKSPACE_CHUNK_SIZE,
  }: SelectByIdChunksOptions = {}
): Promise<T[]> {
  if (ids.length === 0) return []

  const rows: T[] = []
  for (const chunkIds of chunkArray(ids, chunkSize)) {
    if (rows.length >= overallLimit) break
    const remaining = overallLimit - rows.length
    const chunkRows = await query(chunkIds, remaining)
    rows.push(...chunkRows)
  }
  return rows
}

export interface TableCleanupResult {
  table: string
  deleted: number
  failed: number
}

export interface ChunkedBatchDeleteOptions<TRow extends { id: string }> {
  tableDef: PgTable
  workspaceIds: string[]
  tableName: string
  /** SELECT eligible rows for one workspace chunk. The result must include `id`. */
  selectChunk: (chunkIds: string[], limit: number) => Promise<TRow[]>
  /** Runs between SELECT and DELETE; receives the just-selected rows. */
  onBatch?: (rows: TRow[]) => Promise<void>
  batchSize?: number
  /** Max batches per workspace chunk. */
  maxBatches?: number
  /**
   * Hard cap on rows processed (deleted + failed) across all chunks per call.
   * Defaults to `DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE`. Cron
   * runs frequently enough to catch up the backlog over multiple invocations.
   */
  totalRowLimit?: number
  workspaceChunkSize?: number
}

/**
 * Inner loop primitive for cleanup jobs.
 *
 * For each workspace chunk: SELECT a batch of eligible rows → run optional
 * `onBatch` hook (e.g. to delete S3 files) → DELETE those rows by ID. Repeats
 * until exhausted or `maxBatches` is hit, then moves to the next chunk. Stops
 * the whole call once `totalRowLimit` rows have been processed.
 *
 * Workspace IDs are chunked before the SELECT — see
 * `DEFAULT_WORKSPACE_CHUNK_SIZE` for why.
 */
export async function chunkedBatchDelete<TRow extends { id: string }>({
  tableDef,
  workspaceIds,
  tableName,
  selectChunk,
  onBatch,
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = DEFAULT_MAX_BATCHES_PER_TABLE,
  totalRowLimit = DEFAULT_BATCH_SIZE * DEFAULT_MAX_BATCHES_PER_TABLE,
  workspaceChunkSize = DEFAULT_WORKSPACE_CHUNK_SIZE,
}: ChunkedBatchDeleteOptions<TRow>): Promise<TableCleanupResult> {
  const result: TableCleanupResult = { table: tableName, deleted: 0, failed: 0 }

  if (workspaceIds.length === 0) {
    logger.info(`[${tableName}] Skipped — no workspaces in scope`)
    return result
  }

  const chunks = chunkArray(workspaceIds, workspaceChunkSize)
  let stoppedEarly = false

  for (const [chunkIdx, chunkIds] of chunks.entries()) {
    if (result.deleted + result.failed >= totalRowLimit) {
      stoppedEarly = true
      break
    }

    let batchesProcessed = 0
    let hasMore = true

    while (
      hasMore &&
      batchesProcessed < maxBatches &&
      result.deleted + result.failed < totalRowLimit
    ) {
      let rows: TRow[] = []
      try {
        rows = await selectChunk(chunkIds, batchSize)

        if (rows.length === 0) {
          hasMore = false
          break
        }

        if (onBatch) await onBatch(rows)

        const ids = rows.map((r) => r.id)
        const deleted = await db
          .delete(tableDef)
          .where(inArray(sql`id`, ids))
          .returning({ id: sql`id` })

        result.deleted += deleted.length
        hasMore = rows.length === batchSize
        batchesProcessed++
      } catch (error) {
        // Count rows we tried to delete; SELECT-stage errors leave rows=[].
        result.failed += rows.length
        logger.error(
          `[${tableName}] Batch failed (chunk ${chunkIdx + 1}/${chunks.length}, ${rows.length} rows):`,
          { error }
        )
        hasMore = false
      }
    }
  }

  logger.info(
    `[${tableName}] Complete: ${result.deleted} deleted, ${result.failed} failed across ${chunks.length} chunks${stoppedEarly ? ' (row-limit reached, remaining chunks deferred to next run)' : ''}`
  )

  return result
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
  workspaceChunkSize?: number
}

/**
 * Convenience wrapper around `chunkedBatchDelete` for the common case: delete
 * rows where `workspaceId IN (...) AND timestamp < retentionDate`. Use this
 * when there's no per-row side effect (e.g. no S3 files to clean up alongside).
 */
export async function batchDeleteByWorkspaceAndTimestamp({
  tableDef,
  workspaceIdCol,
  timestampCol,
  workspaceIds,
  retentionDate,
  tableName,
  requireTimestampNotNull = false,
  ...rest
}: BatchDeleteOptions): Promise<TableCleanupResult> {
  return chunkedBatchDelete({
    tableDef,
    workspaceIds,
    tableName,
    selectChunk: (chunkIds, limit) => {
      const predicates = [inArray(workspaceIdCol, chunkIds), lt(timestampCol, retentionDate)]
      if (requireTimestampNotNull) predicates.push(isNotNull(timestampCol))
      return db
        .select({ id: sql<string>`id` })
        .from(tableDef)
        .where(and(...predicates))
        .limit(limit)
    },
    ...rest,
  })
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
