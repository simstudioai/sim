/**
 * Column and schema-management service for user tables.
 *
 * Standalone column-mutation operations (add, rename, delete, type change,
 * constraint change) extracted from the table service. Each acquires the
 * table's advisory lock via {@link withLockedTable} from `@/lib/table/service`.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, sql } from 'drizzle-orm'
import { columnMatchesRef, generateColumnId, getColumnId } from '@/lib/table/column-keys'
import { COLUMN_TYPES, NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'
import { stripGroupExecutions } from '@/lib/table/rows/executions'
import { withLockedTable } from '@/lib/table/service'
import { scaledStatementTimeoutMs, setTableTxTimeouts } from '@/lib/table/tx'
import type {
  DeleteColumnData,
  RenameColumnData,
  RowData,
  TableDefinition,
  TableMetadata,
  TableSchema,
  UpdateColumnConstraintsData,
  UpdateColumnTypeData,
} from '@/lib/table/types'
import { assertValidSchema, stripGroupDeps } from '@/lib/table/workflow-columns'

const logger = createLogger('TableColumnService')

/**
 * Adds a column to an existing table's schema.
 *
 * @param tableId - Table ID to update
 * @param column - Column definition to add
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found or column name already exists
 */
export async function addTableColumn(
  tableId: string,
  column: {
    id?: string
    name: string
    type: string
    required?: boolean
    unique?: boolean
    position?: number
  },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(tableId, async (table, trx) => {
    if (!NAME_PATTERN.test(column.name)) {
      throw new Error(
        `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
      )
    }

    if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }

    if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
      throw new Error(
        `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
      )
    }

    const schema = table.schema
    if (schema.columns.some((c) => c.name.toLowerCase() === column.name.toLowerCase())) {
      throw new Error(`Column "${column.name}" already exists`)
    }

    if (schema.columns.length >= TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Table has reached maximum column limit (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE})`
      )
    }

    const newColumn: TableSchema['columns'][number] = {
      // Honor a caller-provided id (undo of a delete reuses the original id);
      // otherwise mint a fresh one.
      id: column.id ?? generateColumnId(),
      name: column.name,
      type: column.type as TableSchema['columns'][number]['type'],
      required: column.required ?? false,
      unique: column.unique ?? false,
    }
    const newColumnId = getColumnId(newColumn)

    const columns = [...schema.columns]
    if (column.position !== undefined && column.position >= 0 && column.position < columns.length) {
      columns.splice(column.position, 0, newColumn)
    } else {
      columns.push(newColumn)
    }

    const updatedSchema: TableSchema = { ...schema, columns }

    // Keep `metadata.columnOrder` (a list of column ids) in sync: splicing the
    // new column's id at the same index we used in `columns` keeps display
    // ordering aligned with the user's intent for `position`-based inserts.
    const existingOrder = table.metadata?.columnOrder
    let updatedMetadata = table.metadata
    if (existingOrder && existingOrder.length > 0 && !existingOrder.includes(newColumnId)) {
      let insertIdx = existingOrder.length
      if (column.position !== undefined && column.position >= 0) {
        // Anchor on the column previously at `position` — that column shifted
        // right by one in `columns`, so the new id slots in at its old spot.
        const anchor = schema.columns[column.position]
        if (anchor) {
          const anchorIdx = existingOrder.indexOf(getColumnId(anchor))
          if (anchorIdx !== -1) insertIdx = anchorIdx
        }
      }
      const nextOrder = [...existingOrder]
      nextOrder.splice(insertIdx, 0, newColumnId)
      updatedMetadata = { ...table.metadata, columnOrder: nextOrder }
    }

    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, tableId))

    logger.info(`[${requestId}] Added column "${column.name}" to table ${tableId}`)

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })
}

/**
 * Renames a column in a table's schema and updates all row data keys.
 *
 * @param data - Rename column data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or new name conflicts
 */
export async function renameColumn(
  data: RenameColumnData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    if (!NAME_PATTERN.test(data.newName)) {
      throw new Error(
        `Invalid column name "${data.newName}". Column names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
      )
    }

    if (data.newName.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
      throw new Error(
        `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
      )
    }

    const schema = table.schema
    const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.oldName))
    if (columnIndex === -1) {
      throw new Error(`Column "${data.oldName}" not found`)
    }

    if (
      schema.columns.some(
        (c, i) => i !== columnIndex && c.name.toLowerCase() === data.newName.toLowerCase()
      )
    ) {
      throw new Error(`Column "${data.newName}" already exists`)
    }

    const targetColumn = schema.columns[columnIndex]
    const actualOldName = targetColumn.name

    // Rename is metadata-only: stored rows, metadata, and workflow-group refs all
    // key on the column's stable id, which a rename never changes — so this is a
    // pure schema write, no per-row JSONB rewrite or group/metadata cascade.
    // Stamp the current storage key as the id (for any not-yet-backfilled column)
    // so existing rows stay reachable as the display name changes.
    const columnId = targetColumn.id ?? actualOldName
    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex ? { ...c, id: columnId, name: data.newName } : c
    )
    const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
    assertValidSchema(updatedSchema, table.metadata?.columnOrder)

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Renamed column "${actualOldName}" to "${data.newName}" in table ${data.tableId}`
    )
    return { ...table, schema: updatedSchema, updatedAt: now }
  })
}

/** Removes the given column-id keys from a metadata blob (widths/order/pinned). */
function stripColumnIdsFromMetadata(
  metadata: TableMetadata | null,
  ids: ReadonlySet<string>
): TableMetadata | null {
  if (!metadata) return metadata
  let next = metadata
  if (metadata.columnWidths) {
    const widths = { ...metadata.columnWidths }
    let changed = false
    for (const id of ids)
      if (id in widths) {
        delete widths[id]
        changed = true
      }
    if (changed) next = { ...next, columnWidths: widths }
  }
  if (metadata.columnOrder?.some((id) => ids.has(id))) {
    next = { ...next, columnOrder: metadata.columnOrder.filter((id) => !ids.has(id)) }
  }
  if (metadata.pinnedColumns?.some((id) => ids.has(id))) {
    next = { ...next, pinnedColumns: metadata.pinnedColumns.filter((id) => !ids.has(id)) }
  }
  return next
}

/**
 * Fire-and-forget reclamation of a deleted column's row storage. The column is
 * already gone from the schema, so reads never surface the orphaned id —
 * dropping the JSONB key just frees space. Runs in its own transaction with a
 * row-count-scaled timeout; failures are logged, not propagated.
 */
function stripColumnDataInBackground(
  tableId: string,
  columnIds: string[],
  rowCount: number,
  requestId: string
): void {
  if (columnIds.length === 0) return
  void (async () => {
    try {
      await db.transaction(async (trx) => {
        const statementMs = scaledStatementTimeoutMs(rowCount, {
          baseMs: 60_000,
          perRowMs: 2 * columnIds.length,
        })
        await setTableTxTimeouts(trx, { statementMs })
        for (const id of columnIds) {
          await trx.execute(
            sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${tableId} AND data ? ${id}::text`
          )
        }
      })
      logger.info(
        `[${requestId}] Background-stripped deleted column data [${columnIds.join(', ')}] from table ${tableId}`
      )
    } catch (err) {
      logger.error(
        `[${requestId}] Background column-data strip failed for table ${tableId} [${columnIds.join(', ')}]:`,
        err
      )
    }
  })()
}

/**
 * Deletes a column from a table's schema. When id-keyed, returns once the schema
 * is updated and reclaims the column's row-data storage in the background
 * (fire-and-forget); the legacy path strips the row key synchronously.
 *
 * @param data - Delete column data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or it's the last column
 */
export async function deleteColumn(
  data: DeleteColumnData,
  requestId: string
): Promise<TableDefinition> {
  const { def, stripKey } = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    if (schema.columns.length <= 1) {
      throw new Error('Cannot delete the last column in a table')
    }

    const targetColumn = schema.columns[columnIndex]
    const actualName = targetColumn.name
    const columnId = getColumnId(targetColumn)
    const ownerGroupId = targetColumn.workflowGroupId

    // Drop this column's reference (by id) from every group's outputs and
    // `columns` dependency. If the column is the last output of its parent
    // group, the group itself is also removed (a group with zero outputs is
    // invalid).
    let groupRemovedId: string | null = null
    const updatedGroups = (schema.workflowGroups ?? [])
      .map((group) => {
        let next = group
        if (ownerGroupId && group.id === ownerGroupId) {
          const remaining = group.outputs.filter((o) => o.columnName !== columnId)
          if (remaining.length === 0) {
            groupRemovedId = group.id
          }
          next = { ...next, outputs: remaining }
        }
        return stripGroupDeps(next, new Set([columnId]))
      })
      .filter((g) => g.id !== groupRemovedId)

    const updatedSchema: TableSchema = {
      ...schema,
      columns: schema.columns.filter((_, i) => i !== columnIndex),
      ...(updatedGroups.length > 0 ? { workflowGroups: updatedGroups } : {}),
    }
    const updatedMetadata = stripColumnIdsFromMetadata(
      table.metadata as TableMetadata | null,
      new Set([columnId])
    )
    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()

    // Schema/metadata update commits now; the column's row-data storage is
    // reclaimed in the background (fire-and-forget) — reads never surface the
    // orphaned id since the column is already gone from the schema.
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    if (groupRemovedId) await stripGroupExecutions(trx, data.tableId, [groupRemovedId])

    logger.info(`[${requestId}] Deleted column "${actualName}" from table ${data.tableId}`)

    return {
      def: { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now },
      stripKey: columnId,
    }
  })

  stripColumnDataInBackground(data.tableId, [stripKey], def.rowCount ?? 0, requestId)
  return def
}

/**
 * Deletes multiple columns from a table in a single transaction.
 * Avoids the race condition of calling deleteColumn multiple times in parallel.
 */
export async function deleteColumns(
  data: { tableId: string; columnNames: string[] },
  requestId: string
): Promise<TableDefinition> {
  const { def, stripKeys } = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const namesToDelete = new Set<string>()
    const idsToDelete = new Set<string>()
    const notFound: string[] = []

    for (const name of data.columnNames) {
      const col = schema.columns.find((c) => columnMatchesRef(c, name))
      if (!col) {
        notFound.push(name)
      } else {
        namesToDelete.add(col.name)
        idsToDelete.add(getColumnId(col))
      }
    }

    if (notFound.length > 0) {
      throw new Error(`Columns not found: ${notFound.join(', ')}`)
    }

    const remaining = schema.columns.filter((c) => !namesToDelete.has(c.name))
    if (remaining.length === 0) {
      throw new Error('Cannot delete all columns from a table')
    }

    // For each group, drop outputs whose column (by id) is being deleted. Groups
    // that end up with zero outputs are removed entirely (they'd be invalid).
    // Then any remaining group's dependencies referencing a removed column are
    // cleaned up.
    const removedGroupIds = new Set<string>()
    let updatedGroups = (schema.workflowGroups ?? []).map((group) => {
      const remainingOutputs = group.outputs.filter((o) => !idsToDelete.has(o.columnName))
      if (remainingOutputs.length === 0) {
        removedGroupIds.add(group.id)
      }
      return remainingOutputs.length === group.outputs.length
        ? group
        : { ...group, outputs: remainingOutputs }
    })
    updatedGroups = updatedGroups
      .filter((g) => !removedGroupIds.has(g.id))
      .map((group) => stripGroupDeps(group, idsToDelete))
    const updatedSchema: TableSchema = {
      ...schema,
      columns: remaining,
      ...(updatedGroups.length > 0 ? { workflowGroups: updatedGroups } : {}),
    }
    const updatedMetadata = stripColumnIdsFromMetadata(
      table.metadata as TableMetadata | null,
      idsToDelete
    )
    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()

    // Schema/metadata commit now; row storage for the deleted columns is
    // reclaimed in the background (fire-and-forget).
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    await stripGroupExecutions(trx, data.tableId, removedGroupIds)

    logger.info(
      `[${requestId}] Deleted columns [${[...namesToDelete].join(', ')}] from table ${data.tableId}`
    )

    return {
      def: { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now },
      stripKeys: Array.from(idsToDelete),
    }
  })

  if (stripKeys.length > 0) {
    stripColumnDataInBackground(data.tableId, stripKeys, def.rowCount ?? 0, requestId)
  }
  return def
}

/**
 * Changes the type of a column. Validates that existing data is compatible.
 *
 * @param data - Update column type data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or existing data is incompatible
 */
export async function updateColumnType(
  data: UpdateColumnTypeData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    // Scale both statement and idle timeouts to row count: the compatibility
    // check below iterates every row in Node between the row SELECT and the
    // schema UPDATE, leaving the transaction idle for that gap. The default 5s
    // `idle_in_transaction_session_timeout` would abort a valid type change on
    // a large table.
    const timeoutMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs: timeoutMs, idleMs: timeoutMs })

    if (!(COLUMN_TYPES as readonly string[]).includes(data.newType)) {
      throw new Error(
        `Invalid column type "${data.newType}". Valid types: ${COLUMN_TYPES.join(', ')}`
      )
    }

    const schema = table.schema
    const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    const column = schema.columns[columnIndex]
    if (column.type === data.newType) {
      return table
    }
    const columnKey = getColumnId(column)

    // Validate existing data is compatible with the new type
    const rows = await trx
      .select({ id: userTableRows.id, data: userTableRows.data })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, data.tableId),
          sql`${userTableRows.data} ? ${columnKey}`,
          sql`${userTableRows.data}->>${columnKey}::text IS NOT NULL`
        )
      )

    let incompatibleCount = 0
    for (const row of rows) {
      const rowData = row.data as RowData
      const value = rowData[columnKey]
      if (value === null || value === undefined) continue

      if (!isValueCompatibleWithType(value, data.newType)) {
        incompatibleCount++
      }
    }

    if (incompatibleCount > 0) {
      throw new Error(
        `Cannot change column "${column.name}" to type "${data.newType}": ${incompatibleCount} row(s) have incompatible values. Fix or remove the incompatible values first.`
      )
    }

    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex ? { ...c, type: data.newType } : c
    )
    const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Changed column "${column.name}" type from "${column.type}" to "${data.newType}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, updatedAt: now }
  })
}

/**
 * Updates constraints (required, unique) on a column.
 *
 * @param data - Update column constraints data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or existing data violates the constraint
 */
export async function updateColumnConstraints(
  data: UpdateColumnConstraintsData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    // Scale both statement and idle timeouts to row count: the required/unique
    // validation runs between separate queries inside this transaction, leaving
    // it briefly idle. Match `updateColumnType` so the default 5s
    // `idle_in_transaction_session_timeout` can't abort a valid change on a
    // large table.
    const timeoutMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
      baseMs: 60_000,
      perRowMs: 2,
    })
    await setTableTxTimeouts(trx, { statementMs: timeoutMs, idleMs: timeoutMs })

    const schema = table.schema
    const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
    if (columnIndex === -1) {
      throw new Error(`Column "${data.columnName}" not found`)
    }

    const column = schema.columns[columnIndex]
    const columnKey = getColumnId(column)
    if (column.workflowGroupId) {
      throw new Error(
        `Cannot change constraints on workflow-output column "${column.name}". Constraints aren't applicable to columns whose values come from workflow execution.`
      )
    }
    if (data.required === true && !column.required) {
      const [result] = await trx
        .select({ count: count() })
        .from(userTableRows)
        .where(
          and(
            eq(userTableRows.tableId, data.tableId),
            sql`(NOT (${userTableRows.data} ? ${columnKey}) OR ${userTableRows.data}->>${columnKey}::text IS NULL)`
          )
        )

      if (result.count > 0) {
        throw new Error(
          `Cannot set column "${column.name}" as required: ${result.count} row(s) have null or missing values`
        )
      }
    }

    if (data.unique === true && !column.unique) {
      const duplicates = (await trx.execute(
        sql`SELECT ${userTableRows.data}->>${columnKey}::text AS val, count(*) AS cnt FROM ${userTableRows} WHERE table_id = ${data.tableId} AND ${userTableRows.data} ? ${columnKey} AND ${userTableRows.data}->>${columnKey}::text IS NOT NULL GROUP BY val HAVING count(*) > 1 LIMIT 1`
      )) as { val: string; cnt: number }[]

      if (duplicates.length > 0) {
        throw new Error(`Cannot set column "${column.name}" as unique: duplicate values exist`)
      }
    }

    const updatedColumns = schema.columns.map((c, i) =>
      i === columnIndex
        ? {
            ...c,
            ...(data.required !== undefined ? { required: data.required } : {}),
            ...(data.unique !== undefined ? { unique: data.unique } : {}),
          }
        : c
    )
    const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
    const now = new Date()

    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Updated constraints for column "${column.name}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, updatedAt: now }
  })
}

/**
 * Checks if a value is compatible with a target column type.
 */
function isValueCompatibleWithType(
  value: unknown,
  targetType: (typeof COLUMN_TYPES)[number]
): boolean {
  if (value === null || value === undefined) return true

  switch (targetType) {
    case 'string':
      return true
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value)
      if (typeof value === 'string') {
        const num = Number(value)
        return Number.isFinite(num) && value.trim() !== ''
      }
      return false
    }
    case 'boolean': {
      if (typeof value === 'boolean') return true
      if (typeof value === 'string')
        return ['true', 'false', '1', '0'].includes(value.toLowerCase())
      if (typeof value === 'number') return value === 0 || value === 1
      return false
    }
    case 'date': {
      if (value instanceof Date) return !Number.isNaN(value.getTime())
      if (typeof value === 'string') return !Number.isNaN(Date.parse(value))
      return false
    }
    case 'json':
      return true
    default:
      return false
  }
}
