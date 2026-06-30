/**
 * Row position / fractional-ordering internals for the table service layer.
 *
 * Internal module: only the import/delete-runner entry points are exposed via
 * the `@/lib/table/rows/ordering` path. Not re-exported through the
 * `@/lib/table` barrel.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, type SQL, sql } from 'drizzle-orm'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
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

/** Shifts every row at or after `position` up by one (`position + 1`). */
export async function shiftRowsUpFrom(trx: DbTransaction, tableId: string, position: number) {
  await trx
    .update(userTableRows)
    .set({ position: sql`position + 1` })
    .where(and(eq(userTableRows.tableId, tableId), gte(userTableRows.position, position)))
}

/** Shifts every row after `position` down by one (`position - 1`). */
export async function shiftRowsDownAfter(trx: DbTransaction, tableId: string, position: number) {
  await trx
    .update(userTableRows)
    .set({ position: sql`position - 1` })
    .where(and(eq(userTableRows.tableId, tableId), gt(userTableRows.position, position)))
}

/**
 * Reserves the `position` for a single inserted row and returns where to INSERT.
 * Acquires the row-order lock, then opens a slot at `requestedPosition` (shifting
 * the occupant + tail up) or computes the append position. Caller runs inside a
 * transaction.
 */
export async function reserveInsertPosition(
  trx: DbTransaction,
  tableId: string,
  requestedPosition?: number
): Promise<number> {
  await acquireRowOrderLock(trx, tableId)
  if (requestedPosition === undefined) {
    return nextRowPosition(trx, tableId)
  }
  const [existing] = await trx
    .select({ id: userTableRows.id })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, requestedPosition)))
    .limit(1)
  if (existing) {
    await shiftRowsUpFrom(trx, tableId, requestedPosition)
  }
  return requestedPosition
}

/**
 * Reserves positions for a batch of `count` rows. Opens each requested slot
 * (ascending, preserving prior gaps) and returns the requested positions in
 * original order; otherwise returns a contiguous append range.
 */
export async function reserveBatchPositions(
  trx: DbTransaction,
  tableId: string,
  count: number,
  requestedPositions?: number[]
): Promise<number[]> {
  await acquireRowOrderLock(trx, tableId)
  if (requestedPositions && requestedPositions.length > 0) {
    for (const pos of [...requestedPositions].sort((a, b) => a - b)) {
      await shiftRowsUpFrom(trx, tableId, pos)
    }
    return requestedPositions
  }
  const start = await nextRowPosition(trx, tableId)
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * Recompacts row positions to be contiguous after a bulk delete. With
 * `minDeletedPos`, only rows at/after it are re-numbered; single-row deletes use
 * the cheaper {@link shiftRowsDownAfter}.
 */
export async function compactPositions(
  trx: DbTransaction,
  tableId: string,
  minDeletedPos?: number
) {
  if (minDeletedPos === undefined) {
    await trx.execute(sql`
      UPDATE user_table_rows t
      SET position = r.new_pos
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
        FROM user_table_rows
        WHERE table_id = ${tableId}
      ) r
      WHERE t.id = r.id AND t.table_id = ${tableId} AND t.position != r.new_pos
    `)
    return
  }
  await trx.execute(sql`
    UPDATE user_table_rows t
    SET position = r.new_pos
    FROM (
      SELECT id, ${minDeletedPos}::int + ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
      FROM user_table_rows
      WHERE table_id = ${tableId} AND position >= ${minDeletedPos}
    ) r
    WHERE t.id = r.id AND t.table_id = ${tableId} AND t.position != r.new_pos
  `)
}

/**
 * Computes the fractional `order_key` for a row inserted at the integer
 * `requestedPosition` (or appended when omitted). Used by position-based callers
 * (mothership tool, v1 API, undo position-fallback, transient old clients).
 *
 * The neighbor at slot `s` is resolved differently per flag state:
 * - **off**: `WHERE position = s` (positions are contiguous, so the row at
 *   position `s` is the `s`-th row — an indexed O(1) lookup).
 * - **on**: the `s`-th row in `order_key, id` order (`OFFSET s`) — positions are
 *   gappy and non-authoritative, so `position = s` would miss; the visual
 *   ordinal is the key's ordinal. O(s), acceptable for these low-volume callers.
 *
 * Caller holds the row-order lock.
 */
export async function resolveInsertOrderKey(
  trx: DbTransaction,
  tableId: string,
  requestedPosition?: number
): Promise<string> {
  const fractionalOrdering = await isFeatureEnabled('tables-fractional-ordering')
  const orderKeyAtSlot = async (slot: number): Promise<string | null> => {
    if (slot < 0) return null
    if (fractionalOrdering) {
      const [r] = await trx
        .select({ orderKey: userTableRows.orderKey })
        .from(userTableRows)
        .where(eq(userTableRows.tableId, tableId))
        .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))
        .limit(1)
        .offset(slot)
      return r?.orderKey ?? null
    }
    const [r] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, slot)))
      .limit(1)
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
 * (O(1)) and mints a key between them. Also returns a legacy integer `position`
 * (anchor's position ±) so the flag-off shift path still works. Caller holds the
 * row-order lock.
 */
export async function resolveInsertByNeighbor(
  trx: DbTransaction,
  tableId: string,
  afterRowId?: string,
  beforeRowId?: string
): Promise<{ orderKey: string; position: number }> {
  const anchorId = afterRowId ?? beforeRowId!
  const [anchor] = await trx
    .select({ orderKey: userTableRows.orderKey, position: userTableRows.position })
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.id, anchorId)))
    .limit(1)
  // The client targets a specific neighbor; a missing one (concurrent delete /
  // stale view) is an error, not a silent insert at the front.
  if (!anchor) throw new Error(`Row not found: ${anchorId}`)
  const anchorKey = anchor.orderKey ?? null
  // A null key on the anchor means the table isn't backfilled. With the flag on
  // (key is authoritative) the adjacent-key lookup below can't work — fail
  // loudly rather than mint a wrong key. Flag off keeps `position` authoritative,
  // so a best-effort key here is fine (the backfill re-keys before the flip).
  const fractionalOrdering = await isFeatureEnabled('tables-fractional-ordering')
  if (anchorKey === null && fractionalOrdering) {
    throw new Error(`Row ${anchorId} has no order_key yet (table not backfilled)`)
  }

  if (afterRowId) {
    // hi = the smallest key strictly GREATER than the anchor key. Comparing keys
    // (not the `(order_key, id)` row tuple) skips past any sibling that shares the
    // anchor's key, so `keyBetween` always gets strictly-ordered bounds and can't
    // throw on a stray duplicate. Identical to the row tuple when keys are distinct.
    // A null anchorKey (flag off, un-backfilled) has no key to compare — leave the
    // upper bound open, matching the prior best-effort behavior.
    let nextKey: string | null = null
    if (anchorKey !== null) {
      const [next] = await trx
        .select({ orderKey: userTableRows.orderKey })
        .from(userTableRows)
        .where(and(eq(userTableRows.tableId, tableId), gt(userTableRows.orderKey, anchorKey)))
        .orderBy(asc(userTableRows.orderKey))
        .limit(1)
      nextKey = next?.orderKey ?? null
    }
    return {
      orderKey: keyBetween(anchorKey, nextKey),
      position: anchor.position + 1,
    }
  }

  // beforeRowId: lo = the largest key strictly LESS than the anchor key (distinct,
  // same rationale as the afterRowId branch above).
  let prevKey: string | null = null
  if (anchorKey !== null) {
    const [prev] = await trx
      .select({ orderKey: userTableRows.orderKey })
      .from(userTableRows)
      .where(and(eq(userTableRows.tableId, tableId), lt(userTableRows.orderKey, anchorKey)))
      .orderBy(desc(userTableRows.orderKey))
      .limit(1)
    prevKey = prev?.orderKey ?? null
  }
  return {
    orderKey: keyBetween(prevKey, anchorKey),
    position: anchor.position,
  }
}

/**
 * Computes fractional `order_key`s for a batch insert. With no `positions`,
 * appends a contiguous run after the current max key. With explicit `positions`
 * (undo restore), keys each row between its pre-shift position neighbors —
 * correct because requested positions are distinct. Caller holds the lock.
 *
 * The explicit-`positions` path is meaningful only when `position` is
 * authoritative (flag off): with the flag on, a saved `position` is a gappy
 * column value, not a visual rank, so feeding it to {@link resolveInsertOrderKey}
 * (which reads `position` as an `OFFSET` rank under the flag) would mint keys at
 * the wrong ranks. Callers needing exact placement under the flag pass
 * `orderKeys` (handled before this function); here we just append a run.
 */
export async function resolveBatchInsertOrderKeys(
  trx: DbTransaction,
  tableId: string,
  count: number,
  positions?: number[]
): Promise<string[]> {
  if (
    !positions ||
    positions.length === 0 ||
    (await isFeatureEnabled('tables-fractional-ordering'))
  ) {
    return nKeysBetween(await maxOrderKey(trx, tableId), null, count)
  }
  const keys: string[] = []
  for (const pos of positions) {
    keys.push(await resolveInsertOrderKey(trx, tableId, pos))
  }
  return keys
}

/**
 * Inserts a single row in its own transaction. Always assigns a fractional
 * `order_key`. When the fractional-ordering flag is on, `order_key` is
 * authoritative and `position` is a best-effort append (no O(N) shift); when
 * off, `position` is reserved as before (shifting to open the slot). Validation
 * and side-effect dispatch stay with the caller; capacity is enforced by the
 * `increment_user_table_row_count` trigger.
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

    const fractionalOrdering = await isFeatureEnabled('tables-fractional-ordering')

    // Resolve the order key (and a legacy slot position for the flag-off shift
    // path) from neighbor ids when given, else from the requested position.
    let orderKey: string
    let slotPosition = position
    if (afterRowId || beforeRowId) {
      const resolved = await resolveInsertByNeighbor(trx, tableId, afterRowId, beforeRowId)
      orderKey = resolved.orderKey
      slotPosition = resolved.position
    } else {
      orderKey = await resolveInsertOrderKey(trx, tableId, position)
    }

    let targetPosition: number
    if (fractionalOrdering) {
      // order_key is authoritative — keep a best-effort, no-shift position.
      targetPosition = await nextRowPosition(trx, tableId)
    } else if (slotPosition !== undefined) {
      const [existing] = await trx
        .select({ id: userTableRows.id })
        .from(userTableRows)
        .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.position, slotPosition)))
        .limit(1)
      if (existing) await shiftRowsUpFrom(trx, tableId, slotPosition)
      targetPosition = slotPosition
    } else {
      targetPosition = await nextRowPosition(trx, tableId)
    }

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
 * Deletes a single row by id in its own transaction, then closes the positional
 * gap. Returns `false` when no row matched.
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
      .returning({ position: userTableRows.position })
    if (!deleted) return false
    // Fractional ordering: deleting a row never changes another row's order_key,
    // so the O(N) position reshift is skipped entirely.
    if (!(await isFeatureEnabled('tables-fractional-ordering'))) {
      await shiftRowsDownAfter(trx, tableId, deleted.position)
    }
    return true
  })
}

/**
 * Deletes the given row ids in batches within one transaction, then recompacts
 * positions from the earliest deleted slot. Returns the deleted rows (id + prior
 * position). The caller resolves which ids to delete (used by both delete-by-ids
 * and delete-by-filter).
 */
export async function deleteOrderedRowsByIds(params: {
  tableId: string
  workspaceId: string
  rowIds: string[]
}): Promise<{ id: string; position: number }[]> {
  const { tableId, workspaceId, rowIds } = params
  if (rowIds.length === 0) return []
  return db.transaction(async (trx) => {
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    const deleted: { id: string; position: number }[] = []
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
        .returning({ id: userTableRows.id, position: userTableRows.position })
      deleted.push(...rows)
    }
    // Fractional ordering: deletes leave order_key untouched, so no recompaction.
    if (!(await isFeatureEnabled('tables-fractional-ordering')) && deleted.length > 0) {
      const minDeletedPos = deleted.reduce(
        (min, r) => (r.position < min ? r.position : min),
        deleted[0].position
      )
      await compactPositions(trx, tableId, minDeletedPos)
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
 * Like {@link selectRowIdPage} but returns each row's `data` too, for the bulk-update worker which
 * must merge the patch into the existing row to validate the result. Same keyset walk on the
 * `(table_id, id)` index, `created_at <= cutoff`, tenant-scoped, seqscan-off for jsonb filters.
 *
 * `excludeIfPatched` (a JSON patch string) skips rows that already contain the patch
 * (`data @> patch`). The update worker passes it so a retried run doesn't re-walk and re-count
 * rows an earlier attempt already updated — updated rows still exist (unlike deletes), and they
 * still match the filter when the patch doesn't touch a filtered column, so without this a retry
 * would double-count progress. It also skips no-op updates of rows that already hold those values.
 */
export async function selectRowDataPage(params: {
  tableId: string
  workspaceId: string
  cutoff: Date
  filterClause?: SQL
  afterId?: string
  limit: number
  excludeIfPatched?: string
}): Promise<Array<{ id: string; data: RowData }>> {
  const { tableId, workspaceId, cutoff, filterClause, afterId, limit, excludeIfPatched } = params
  const selectPage = (executor: DbExecutor) =>
    executor
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId),
          lte(userTableRows.createdAt, cutoff),
          afterId ? gt(userTableRows.id, afterId) : undefined,
          excludeIfPatched
            ? sql`NOT (${userTableRows.data} @> ${excludeIfPatched}::jsonb)`
            : undefined,
          filterClause
        )
      )
      .orderBy(asc(userTableRows.id))
      .limit(limit)
  const rows = filterClause
    ? await withSeqscanOff(async (trx) => selectPage(trx))
    : await selectPage(db)
  return rows.map((r) => ({ id: r.id, data: r.data as RowData }))
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

/**
 * Applies a JSONB-merge patch (`data || patchJson`) to a page of row ids, committed in
 * UPDATE_BATCH_SIZE chunks (each its own transaction, 60s timeout) so a large background update
 * makes incremental, resumable progress. Returns the number of rows updated.
 */
export async function updatePageByIds(
  tableId: string,
  workspaceId: string,
  rowIds: string[],
  patchJson: string
): Promise<number> {
  const now = new Date()
  let updated = 0
  for (let i = 0; i < rowIds.length; i += TABLE_LIMITS.UPDATE_BATCH_SIZE) {
    const batch = rowIds.slice(i, i + TABLE_LIMITS.UPDATE_BATCH_SIZE)
    const rows = await db.transaction(async (trx) => {
      await setTableTxTimeouts(trx, { statementMs: 60_000 })
      return trx
        .update(userTableRows)
        .set({ data: sql`${userTableRows.data} || ${patchJson}::jsonb`, updatedAt: now })
        .where(
          and(
            eq(userTableRows.tableId, tableId),
            eq(userTableRows.workspaceId, workspaceId),
            inArray(userTableRows.id, batch)
          )
        )
        .returning({ id: userTableRows.id })
    })
    updated += rows.length
  }
  return updated
}
