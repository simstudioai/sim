/**
 * Row position / fractional-ordering internals for the table service layer.
 *
 * Internal module: only the import/delete-runner entry points are exposed via
 * the `@/lib/table/rows/ordering` path. Not re-exported through the
 * `@/lib/table` barrel.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { and, asc, desc, eq, gt, inArray, lt, lte, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { keyBetween, nKeysBetween } from '@/lib/table/order-key'
import { type DbExecutor, type DbTransaction, withSeqscanOff } from '@/lib/table/planner'
import { setTableTxTimeouts } from '@/lib/table/tx'
import type { RowData } from '@/lib/table/types'

/**
 * Starting `position` for an append import — `max(position) + 1`, or 0 when empty. Read once,
 * unlocked, before streaming: the import worker is the table's sole writer, so it can assign
 * contiguous positions from this offset without per-batch position scans.
 */
export async function nextImportStartPosition(tableId: string): Promise<number> {
  const [{ maxPos }] = await db
    .select({
      maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
    })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxPos + 1
}

/**
 * Append anchor `order_key` for an import — `max(order_key)`, or null when empty. Read once,
 * unlocked, before streaming (the import worker is the table's sole writer); each batch threads
 * the previous batch's last key forward so no per-batch max scan is needed.
 */
export async function nextImportStartOrderKey(tableId: string): Promise<string | null> {
  return maxOrderKey(db, tableId)
}

/**
 * Serializes writers that assign `position` for the same table. The row-count
 * trigger (migration 0198) serializes capacity via a row lock on
 * `user_table_definitions`, but it fires AFTER INSERT, so two concurrent
 * auto-positioned inserts could read the same snapshot and assign the same
 * position (the `(table_id, position)` index is non-unique). This advisory lock
 * restores per-table serialization. Released at COMMIT/ROLLBACK.
 */
export async function acquireRowOrderLock(trx: DbTransaction, tableId: string) {
  await trx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))`
  )
}

/** Next append position for a table (max(position) + 1, or 0 if empty). */
export async function nextRowPosition(trx: DbTransaction, tableId: string): Promise<number> {
  const [{ maxPos }] = await trx
    .select({
      maxPos: sql<number>`coalesce(max(${userTableRows.position}), -1)`.mapWith(Number),
    })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxPos + 1
}

/** Largest `order_key` for a table, or `null` when empty — the append anchor for new keys. */
export async function maxOrderKey(executor: DbOrTx, tableId: string): Promise<string | null> {
  const [{ maxKey }] = await executor
    .select({ maxKey: sql<string | null>`max(${userTableRows.orderKey})` })
    .from(userTableRows)
    .where(eq(userTableRows.tableId, tableId))
  return maxKey ?? null
}

/**
 * Computes the fractional `order_key` for a row inserted at the integer
 * `requestedPosition` (or appended when omitted). Used by position-based callers
 * (mothership tool, v1 API, undo position-fallback, transient old clients).
 *
 * The neighbor at slot `s` is the `s`-th row in `order_key, id` order (`OFFSET
 * s`) — positions are gappy and non-authoritative, so `position = s` would miss;
 * the visual ordinal is the key's ordinal. O(s), acceptable for these low-volume
 * callers.
 *
 * Caller holds the row-order lock.
 */
export async function resolveInsertOrderKey(
  trx: DbTransaction,
  tableId: string,
  requestedPosition?: number
): Promise<string> {
  const orderKeyAtSlot = async (slot: number): Promise<string | null> => {
    if (slot < 0) return null
    const [r] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(eq(userTableRows.tableId, tableId))
      .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
      .limit(1)
      .offset(slot)
    return r?.orderKey ?? null
  }
  if (requestedPosition === undefined) {
    return keyBetween(await maxOrderKey(trx, tableId), null)
  }
  const lo = await orderKeyAtSlot(requestedPosition - 1)
  const hi = await orderKeyAtSlot(requestedPosition)
  return keyBetween(lo, hi)
}

/**
 * Resolves the `order_key` for an insert expressed by an anchor row id —
 * `afterRowId` (place directly after) or `beforeRowId` (directly before). Finds
 * the anchor and its adjacent key via the `(table_id, order_key, id)` index
 * (O(1)) and mints a key between them. Caller holds the row-order lock.
 */
export async function resolveInsertByNeighbor(
  trx: DbTransaction,
  tableId: string,
  afterRowId?: string,
  beforeRowId?: string
): Promise<string> {
  const anchorId = afterRowId ?? beforeRowId!
  const [anchor] = await trx
    .select({ orderKey: userTableRows.orderKey })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.id, anchorId)))
    .limit(1)
  // The client targets a specific neighbor; a missing one (concurrent delete /
  // stale view) is an error, not a silent insert at the front.
  if (!anchor) throw new Error(`Row not found: ${anchorId}`)
  const anchorKey = anchor.orderKey ?? null
  // A null key on the anchor means the table isn't backfilled. order_key is
  // authoritative, so the adjacent-key lookup below can't work — fail loudly
  // rather than mint a wrong key.
  if (anchorKey === null) {
    throw new Error(`Row ${anchorId} has no order_key yet (table not backfilled)`)
  }

  if (afterRowId) {
    // hi = the smallest key strictly GREATER than the anchor key. Comparing keys
    // (not the `(order_key, id)` row tuple) skips past any sibling that shares the
    // anchor's key, so `keyBetween` always gets strictly-ordered bounds and can't
    // throw on a stray duplicate. Identical to the row tuple when keys are distinct.
    const [next] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(and(eq(userTableRows.tableId, tableId), gt(userTableRows.orderKey, anchorKey)))
      .orderBy(asc(userTableRows.orderKey))
      .limit(1)
    return keyBetween(anchorKey, next?.orderKey ?? null)
  }

  // beforeRowId: lo = the largest key strictly LESS than the anchor key (distinct,
  // same rationale as the afterRowId branch above).
  const [prev] = await trx
    .select({ orderKey: userTableRows.orderKey })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), lt(userTableRows.orderKey, anchorKey)))
    .orderBy(desc(userTableRows.orderKey))
    .limit(1)
  return keyBetween(prev?.orderKey ?? null, anchorKey)
}

/**
 * Computes fractional `order_key`s for a batch insert by appending a contiguous
 * run after the current max key. `order_key` is authoritative, so callers needing
 * exact placement pass explicit `orderKeys` (handled before this function); here
 * we just append a run. Caller holds the lock.
 */
export async function resolveBatchInsertOrderKeys(
  trx: DbTransaction,
  tableId: string,
  count: number
): Promise<string[]> {
  return nKeysBetween(await maxOrderKey(trx, tableId), null, count)
}

/**
 * Inserts a single row in its own transaction. Assigns a fractional `order_key`
 * (authoritative) and a best-effort append `position` (no O(N) shift).
 * Validation and side-effect dispatch stay with the caller; capacity is enforced
 * by the `increment_user_table_row_count` trigger.
 */
export async function insertOrderedRow(params: {
  tableId: string
  workspaceId: string
  data: RowData
  rowId: string
  position?: number
  afterRowId?: string
  beforeRowId?: string
  createdBy?: string
  now: Date
}): Promise<{
  id: string
  data: RowData
  position: number
  orderKey: string | null
  createdAt: Date
  updatedAt: Date
}> {
  const { tableId, workspaceId, data, rowId, position, afterRowId, beforeRowId, createdBy, now } =
    params
  const [row] = await db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    await acquireRowOrderLock(trx, tableId)

    // Resolve the authoritative order key from neighbor ids when given, else from
    // the requested position.
    const orderKey =
      afterRowId || beforeRowId
        ? await resolveInsertByNeighbor(trx, tableId, afterRowId, beforeRowId)
        : await resolveInsertOrderKey(trx, tableId, position)

    // order_key is authoritative — keep a best-effort, no-shift position.
    const targetPosition = await nextRowPosition(trx, tableId)

    return trx
      .insert(userTableRows)
      .values({
        id: rowId,
        tableId,
        workspaceId,
        data,
        position: targetPosition,
        orderKey,
        createdAt: now,
        updatedAt: now,
        ...(createdBy ? { createdBy } : {}),
      })
      .returning()
  })
  return {
    id: row.id,
    data: row.data as RowData,
    position: row.position,
    orderKey: row.orderKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Deletes a single row by id in its own transaction. Deleting a row never changes
 * another row's `order_key`, so no positional reshift is needed. Returns `false`
 * when no row matched.
 */
export async function deleteOrderedRow(params: {
  tableId: string
  rowId: string
  workspaceId: string
}): Promise<boolean> {
  const { tableId, rowId, workspaceId } = params
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx)
    const [deleted] = await trx
      .delete(userTableRows)
      .where(
        and(
          eq(userTableRows.id, rowId),
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId)
        )
      )
      .returning({ id: userTableRows.id })
    return Boolean(deleted)
  })
}

/**
 * Deletes the given row ids in batches within one transaction. Deletes leave
 * `order_key` untouched, so no positional recompaction is needed. Returns the
 * deleted row ids. The caller resolves which ids to delete (used by both
 * delete-by-ids and delete-by-filter).
 */
export async function deleteOrderedRowsByIds(params: {
  tableId: string
  workspaceId: string
  rowIds: string[]
}): Promise<{ id: string }[]> {
  const { tableId, workspaceId, rowIds } = params
  if (rowIds.length === 0) return []
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    const deleted: { id: string }[] = []
    for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
      const batch = rowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
      const rows = await trx
        .delete(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, workspaceId),
            inArray(userTableRows.id, batch)
          )
        )
        .returning({ id: userTableRows.id })
      deleted.push(...rows)
    }
    return deleted
  })
}

/**
 * Selects one page of row ids to delete for the async delete-job worker: base scope plus a
 * `created_at <= cutoff` floor (so rows inserted after the job started are never selected) and
 * the caller's optional filter clause. Keyset paginated on `id` via `afterId` so excluded rows
 * (which are skipped, not deleted) still advance the cursor — no OFFSET, no risk of looping on a
 * fully-excluded page.
 */
export async function selectRowIdPage(params: {
  tableId: string
  workspaceId: string
  cutoff: Date
  filterClause?: SQL
  afterId?: string
  limit: number
}): Promise<string[]> {
  const { tableId, workspaceId, cutoff, filterClause, afterId, limit } = params
  const selectPage = (executor: DbExecutor) =>
    executor
      .select({ id: userTableRows.id })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId),
          lte(userTableRows.createdAt, cutoff),
          afterId ? gt(userTableRows.id, afterId) : undefined,
          filterClause
        )
      )
      .orderBy(asc(userTableRows.id))
      .limit(limit)
  // A jsonb filter is unestimatable, so the planner would seq-scan the whole shared relation
  // per page (12.6s measured) — keep it on the tenant's (table_id, id) index.
  const rows = filterClause
    ? await withSeqscanOff(async (trx) => selectPage(trx))
    : await selectPage(db)
  return rows.map((r) => r.id)
}

/**
 * Deletes one page of rows for the async delete-job worker, committing each `DELETE_BATCH_SIZE`
 * chunk in its own short transaction. One statement per transaction bounds how long the
 * statement-level row_count trigger's lock on the definition row is held (a page-wide transaction
 * held it for the entire page, starving concurrent inserts and overrunning `statement_timeout`),
 * and a mid-page failure loses at most one uncommitted batch — the keyset walker (or a task
 * retry) re-walks whatever remains. Skips legacy position compaction: under fractional ordering
 * it's unnecessary, and in the legacy path `position` gaps are harmless — rows still order by
 * position. Returns the count deleted.
 */
export async function deletePageByIds(
  tableId: string,
  workspaceId: string,
  rowIds: string[]
): Promise<number> {
  let deleted = 0
  for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.DELETE_BATCH_SIZE) {
    const batch = rowIds.slice(i, i + TABLE_LIMITS.DELETE_BATCH_SIZE)
    const rows = await db.transaction(async (trx) => {
      await setTableTxTimeouts(trx, { statementMs: 60_000 })
      return trx
        .delete(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, workspaceId),
            inArray(userTableRows.id, batch)
          )
        )
        .returning({ id: userTableRows.id })
    })
    deleted += rows.length
  }
  return deleted
}
