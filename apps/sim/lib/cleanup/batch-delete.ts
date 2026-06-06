import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

const logger = createLogger('BatchDelete')

export const DEFAULT_BATCH_SIZE = 2000
/** 50 × 2000 = 100K row cap per cleanup run; drains long-tail tenants in days, not weeks. */
export const DEFAULT_MAX_BATCHES_PER_TABLE = 50
/**
 * Split workspaceIds into this-sized groups before running SELECT/DELETE. Large
 * IN lists combined with `started_at < X` force Postgres to probe every
 * workspace range in the composite index, which blows the 90s statement timeout
 * at the scale of the full free tier.
 */
export const DEFAULT_WORKSPACE_CHUNK_SIZE = 50
/** Bounds FK cascade trigger queue (per-statement in-memory) and bind-parameter count. */
export const DEFAULT_DELETE_CHUNK_SIZE = 1000

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
  let attempted = 0

  for (const [chunkIdx, chunkIds] of chunks.entries()) {
    if (attempted >= totalRowLimit) {
      stoppedEarly = true
      break
    }

    let batchesProcessed = 0
    let hasMore = true

    while (hasMore && batchesProcessed < maxBatches && attempted < totalRowLimit) {
      let rows: TRow[] = []
      try {
        const remainingLimit = totalRowLimit - attempted
        const effectiveBatchSize = Math.min(batchSize, remainingLimit)
        if (effectiveBatchSize <= 0) {
          hasMore = false
          break
        }

        rows = await selectChunk(chunkIds, effectiveBatchSize)

        if (rows.length === 0) {
          hasMore = false
          break
        }

        attempted += rows.length
        if (onBatch) await onBatch(rows)

        const ids = rows.map((r) => r.id)
        const deleted = await db
          .delete(tableDef)
          .where(inArray(sql`id`, ids))
          .returning({ id: sql`id` })

        result.deleted += deleted.length
        result.failed += rows.length - deleted.length
        hasMore = rows.length === effectiveBatchSize && attempted < totalRowLimit
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
 * Delete by explicit ID list, chunked so each statement is its own transaction.
 * Partial progress survives chunk-level failures.
 */
export async function deleteRowsById(
  tableDef: PgTable,
  idCol: PgColumn,
  ids: string[],
  tableName: string,
  chunkSize: number = DEFAULT_DELETE_CHUNK_SIZE
): Promise<TableCleanupResult> {
  const result: TableCleanupResult = { table: tableName, deleted: 0, failed: 0 }
  if (ids.length === 0) return result

  const chunks = chunkArray(ids, chunkSize)
  for (const [chunkIdx, chunkIds] of chunks.entries()) {
    try {
      const deleted = await db
        .delete(tableDef)
        .where(inArray(idCol, chunkIds))
        .returning({ id: idCol })
      result.deleted += deleted.length
    } catch (error) {
      // Upper bound: Postgres rolls back the chunk on error, so actual deletes = 0,
      // but we can't tell which IDs in the chunk would have matched. The next cron
      // run picks up whatever's still expired, so this only inflates the metric.
      result.failed += chunkIds.length
      logger.error(
        `[${tableName}] Delete chunk ${chunkIdx + 1}/${chunks.length} failed (up to ${chunkIds.length} rows):`,
        { error }
      )
    }
  }

  logger.info(
    `[${tableName}] Deleted ${result.deleted} rows across ${chunks.length} chunk(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}`
  )
  return result
}

export interface DrainByColumnOptions {
  tableDef: PgTable
  /** Single-column primary key used to batch the delete. */
  idCol: PgColumn
  /** Column matched against `matchValue` to scope the drain (e.g. a parent FK). */
  matchCol: PgColumn
  matchValue: string
  tableName: string
  batchSize?: number
  /** Max rows to delete in this call across all batches. */
  rowBudget: number
  /**
   * Extra predicate ANDed into each batch's selection. Re-evaluated per batch
   * (each batch is its own statement), so it can gate the drain on live state —
   * e.g. "the parent row is still soft-deleted" — and stop deleting as soon as
   * that state flips (a restore committed between batches).
   */
  guard?: SQL
}

export interface DrainResult {
  deleted: number
  /**
   * True only when the match set was confirmed empty — via a short final batch
   * or an existence probe after the budget was spent. Batch errors yield
   * `false`; callers must treat `false` as "rows may remain" and defer any
   * dependent parent-delete (whose ON DELETE CASCADE would otherwise fire on the
   * leftovers) to a later run.
   */
  fullyDrained: boolean
}

/**
 * Delete every row matching `matchCol = matchValue` in self-bounded batches,
 * each its own transaction. Use to empty a large child set before deleting its
 * parent so the parent's ON DELETE CASCADE fires on a small (or empty) set
 * instead of millions of rows in one statement.
 */
export async function drainRowsByColumn({
  tableDef,
  idCol,
  matchCol,
  matchValue,
  tableName,
  batchSize = DEFAULT_DELETE_CHUNK_SIZE,
  rowBudget,
  guard,
}: DrainByColumnOptions): Promise<DrainResult> {
  let deleted = 0
  let remaining = rowBudget
  const matchPredicate = guard ? and(eq(matchCol, matchValue), guard) : eq(matchCol, matchValue)

  while (remaining > 0) {
    const limit = Math.min(batchSize, remaining)
    const targetIds = db.select({ id: idCol }).from(tableDef).where(matchPredicate).limit(limit)

    let batchDeleted: { id: unknown }[]
    try {
      batchDeleted = await db
        .delete(tableDef)
        .where(inArray(idCol, targetIds))
        .returning({ id: idCol })
    } catch (error) {
      logger.error(`[${tableName}] Drain batch failed for ${matchValue}:`, { error })
      return { deleted, fullyDrained: false }
    }

    deleted += batchDeleted.length
    remaining -= batchDeleted.length

    // Short batch means the match set is exhausted.
    if (batchDeleted.length < limit) return { deleted, fullyDrained: true }
  }

  // Budget hit on a full final batch — rows may or may not remain. A cheap
  // indexed existence probe disambiguates so a set whose size divides the budget
  // exactly isn't needlessly deferred to a later run.
  try {
    const [leftover] = await db
      .select({ id: idCol })
      .from(tableDef)
      .where(eq(matchCol, matchValue))
      .limit(1)
    return { deleted, fullyDrained: !leftover }
  } catch (error) {
    logger.error(`[${tableName}] Drain remainder probe failed for ${matchValue}:`, { error })
    return { deleted, fullyDrained: false }
  }
}
