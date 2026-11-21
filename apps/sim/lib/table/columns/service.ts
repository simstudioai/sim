/**
 * Column and schema-management service for user tables.
 *
 * Standalone column-mutation operations (add, rename, delete, type change,
 * constraint change) extracted from the table service. Each acquires the
 * table's advisory lock via {@link withLockedTable} from `@/lib/table/service`.
 *
 * Use this for: workflow executor, background jobs, testing business logic.
 * Use API routes for: HTTP requests, frontend clients.
 *
 * Caller-fixable failures throw {@link OrchestrationError} carrying the class
 * the layers above map to a status, so no caller has to search the message for
 * a phrase. A duplicate column name is deliberately `validation` rather than
 * `conflict` — both the v1 route and the orchestration have always answered 400
 * for it, and this refactor is not the place to change a published status.
 */

import { db } from '@sim/db'
import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { resolveCurrencyCode } from '@sim/table-cells/currency'
import { omit } from '@sim/utils/object'
import { and, asc, count, eq, gt, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { columnMatchesRef, generateColumnId, getColumnId } from '@/lib/table/column-keys'
import {
  columnTypeById,
  columnTypeOf,
  isValueCompatible,
  TYPE_SPECIFIC_COLUMN_KEYS,
} from '@/lib/table/column-types'
import { columnTextForEquality } from '@/lib/table/column-types/comparison-sql'
import {
  migrationFrom,
  migrationTo,
  writeBackCoercedCells,
} from '@/lib/table/column-types/registry.server'
import { COLUMN_TYPES, getMaxRowSizeBytes, NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'
import { assertColumnDestructive, assertSchemaMutable } from '@/lib/table/mutation-locks'
import type { DbExecutor, DbTransaction } from '@/lib/table/planner'
import { stripGroupExecutions } from '@/lib/table/rows/executions'
import { updateTableRowsWithDerivedSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { assertValidSchema } from '@/lib/table/schema-invariants'
import { selectValueToNames } from '@/lib/table/select-values'
import { withLockedTable } from '@/lib/table/service'
import { scaledStatementTimeoutMs, setTableTxTimeouts, type TableWriteTx } from '@/lib/table/tx'
import type {
  ColumnDefinition,
  DeleteColumnData,
  JsonValue,
  RenameColumnData,
  SelectOption,
  TableDefinition,
  TableMetadata,
  TableSchema,
  UpdateColumnConstraintsData,
  UpdateColumnCurrencyData,
  UpdateColumnOptionsData,
  UpdateColumnTypeData,
} from '@/lib/table/types'
import { validateColumnDefinition } from '@/lib/table/validation'
import { stripGroupDeps } from '@/lib/table/workflow-group-deps'

const logger = createLogger('TableColumnService')
const COLUMN_RETYPE_SCAN_MAX_BYTES = 32 * 1024 * 1024
const COLUMN_RETYPE_SCAN_MAX_ROWS = 1000

export function getColumnRetypeScanBatchSize(): number {
  return Math.max(
    1,
    Math.min(
      COLUMN_RETYPE_SCAN_MAX_ROWS,
      Math.floor(COLUMN_RETYPE_SCAN_MAX_BYTES / getMaxRowSizeBytes())
    )
  )
}

export interface ColumnMutationOptions {
  expectedWorkspaceId?: string
  /** Joins this transaction instead of opening one, so the write commits with the caller's. */
  tx?: TableWriteTx
}

/** Options only {@link addTableColumn} reads. */
export interface AddColumnOptions extends ColumnMutationOptions {
  /**
   * Refuse a `required` column that any existing row would leave empty. Only workspace-source
   * apply sets it, so an applied manifest refuses what its plan reported. The table, v1 and v2
   * APIs leave it unset and keep accepting such a column, which then constrains later writes.
   */
  refuseEmptyRequired?: boolean
}

/**
 * One page of `columnKey`'s stored values (missing and null cells skipped), by row id after
 * `afterId`. Pages of {@link getColumnRetypeScanBatchSize} rows stay under the scan's byte cap.
 */
export async function readColumnRetypePage(
  trx: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  limit: number,
  afterId?: string
): Promise<Array<{ id: string; value: unknown }>> {
  return trx
    .select({
      id: userTableRows.id,
      value: sql<unknown>`${userTableRows.data}->${columnKey}::text`,
    })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        afterId ? gt(userTableRows.id, afterId) : undefined,
        sql`${userTableRows.data} ? ${columnKey}`,
        sql`${userTableRows.data}->>${columnKey}::text IS NOT NULL`
      )
    )
    .orderBy(asc(userTableRows.id))
    .limit(limit)
}

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
    options?: SelectOption[]
    multiple?: boolean
    currencyCode?: string
  },
  requestId: string,
  options?: AddColumnOptions
): Promise<TableDefinition> {
  return withLockedTable(
    tableId,
    async (table, trx) => {
      assertSchemaMutable(table)
      if (!NAME_PATTERN.test(column.name)) {
        throw new OrchestrationError(
          'validation',
          `Invalid column name "${column.name}". Must start with a letter or underscore and contain only alphanumeric characters and underscores.`
        )
      }

      if (column.name.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
        throw new OrchestrationError(
          'validation',
          `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
        )
      }

      if (!COLUMN_TYPES.includes(column.type as (typeof COLUMN_TYPES)[number])) {
        throw new OrchestrationError(
          'validation',
          `Invalid column type "${column.type}". Must be one of: ${COLUMN_TYPES.join(', ')}`
        )
      }

      const schema = table.schema
      if (schema.columns.some((c) => c.name.toLowerCase() === column.name.toLowerCase())) {
        throw new OrchestrationError('validation', `Column "${column.name}" already exists`)
      }

      if (schema.columns.length >= TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
        throw new OrchestrationError(
          'validation',
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
        ...(column.options ? { options: column.options } : {}),
        ...(column.multiple ? { multiple: true } : {}),
        ...columnTypeById(column.type).defaultMetadata?.(column as ColumnDefinition),
      }

      const columnValidation = validateColumnDefinition(newColumn)
      if (!columnValidation.valid) {
        throw new OrchestrationError(
          'validation',
          `Invalid column: ${columnValidation.errors.join('; ')}`
        )
      }

      const newColumnId = getColumnId(newColumn)

      // A fresh column is empty in every row; one re-added under its old id holds only what its
      // cells still carry. Workspace-source apply refuses a required column over any empty row.
      if (newColumn.required && options?.refuseEmptyRequired) {
        const emptyCount = await countEmptyCells(trx, tableId, table.workspaceId, newColumnId)
        if (emptyCount > 0) {
          throw new OrchestrationError(
            'validation',
            `Column "${column.name}" cannot be added as required: ${emptyCount} row(s) would have no value. Add it without required, fill its cells, then make it required.`
          )
        }
      }

      const columns = [...schema.columns]
      if (
        column.position !== undefined &&
        column.position >= 0 &&
        column.position < columns.length
      ) {
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
        .where(
          and(
            eq(userTableDefinitions.id, tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      logger.info(`Added column "${column.name}" to table ${tableId}`, { requestId })

      return {
        ...table,
        schema: updatedSchema,
        metadata: updatedMetadata,
        updatedAt: now,
      }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
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
  requestId: string,
  options?: ColumnMutationOptions
): Promise<TableDefinition> {
  return withLockedTable(
    data.tableId,
    async (table, trx) => {
      assertSchemaMutable(table)
      if (!NAME_PATTERN.test(data.newName)) {
        throw new OrchestrationError(
          'validation',
          `Invalid column name "${data.newName}". Column names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
        )
      }

      if (data.newName.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
        throw new OrchestrationError(
          'validation',
          `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
        )
      }

      const schema = table.schema
      const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.oldName))
      if (columnIndex === -1) {
        throw new OrchestrationError('not_found', `Column "${data.oldName}" not found`)
      }

      if (
        schema.columns.some(
          (c, i) => i !== columnIndex && c.name.toLowerCase() === data.newName.toLowerCase()
        )
      ) {
        throw new OrchestrationError('validation', `Column "${data.newName}" already exists`)
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
        .where(
          and(
            eq(userTableDefinitions.id, data.tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      logger.info(
        `Renamed column "${actualOldName}" to "${data.newName}" in table ${data.tableId}`,
        { requestId }
      )
      return { ...table, schema: updatedSchema, updatedAt: now }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
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

/** Removes `columnIds`' cells from every row of the table, in `trx`. */
async function stripColumnData(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnIds: string[]
): Promise<void> {
  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere: sql`${userTableRows.tableId} = ${tableId} and ${userTableRows.workspaceId} = ${workspaceId}`,
    transformation: { mode: 'remove-columns', columnIds },
  })
}

/** The statement timeout a strip of `columnCount` columns from `rowCount` rows gets. */
function stripTimeoutMs(rowCount: number, columnCount: number): number {
  return scaledStatementTimeoutMs(rowCount, { baseMs: 60_000, perRowMs: 2 * columnCount })
}

/**
 * Removes the cells of `columnIds`, columns {@link deleteColumn} dropped in `tx` with
 * `callerStripsRows`, from every row of `table`, in one pass under a row-count-scaled timeout, so
 * the row version the commit leaves already holds that write.
 */
export async function stripDroppedColumnData(
  tx: TableWriteTx,
  table: Pick<TableDefinition, 'id' | 'workspaceId' | 'rowCount'>,
  columnIds: string[]
): Promise<void> {
  if (columnIds.length === 0) return
  const timeoutMs = stripTimeoutMs(table.rowCount ?? 0, columnIds.length)
  await setTableTxTimeouts(tx.trx, { statementMs: timeoutMs, idleMs: timeoutMs })
  await stripColumnData(tx.trx, table.id, table.workspaceId, columnIds)
}

/**
 * Fire-and-forget reclamation of a deleted column's row storage. The column is
 * already gone from the schema, so reads never surface the orphaned id —
 * dropping the JSONB key just frees space. Runs in its own transaction with a
 * row-count-scaled timeout; failures are logged, not propagated.
 */
function stripColumnDataInBackground(
  tableId: string,
  workspaceId: string,
  columnIds: string[],
  rowCount: number,
  requestId: string
): void {
  if (columnIds.length === 0) return
  void (async () => {
    try {
      await db.transaction(async (trx) => {
        await setTableTxTimeouts(trx, { statementMs: stripTimeoutMs(rowCount, columnIds.length) })
        await stripColumnData(trx, tableId, workspaceId, columnIds)
      })
      logger.info(
        `Background-stripped deleted column data [${columnIds.join(', ')}] from table ${tableId}`,
        { requestId }
      )
    } catch (err) {
      logger.error(
        `Background column-data strip failed for table ${tableId} [${columnIds.join(', ')}]:`,
        err,
        { requestId }
      )
    }
  })()
}

/**
 * Deletes a column from a table's schema. Returns once the schema is updated and
 * reclaims the column's row-data storage in the background (fire-and-forget),
 * unless `callerStripsRows` leaves that to the caller's transaction
 * ({@link stripDroppedColumnData}).
 *
 * @param data - Delete column data
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if table not found, column not found, or it's the last column
 */
export async function deleteColumn(
  data: DeleteColumnData,
  requestId: string,
  options?: ColumnMutationOptions & {
    /**
     * Leave the column's cells for the caller to strip in its `tx` with
     * {@link stripDroppedColumnData}, once for every column it drops, so the row version the
     * commit leaves already holds that write (workspace source records it for managed rows).
     */
    callerStripsRows?: boolean
  }
): Promise<TableDefinition> {
  const { def, stripKey } = await withLockedTable(
    data.tableId,
    async (table, trx) => {
      assertColumnDestructive(table)
      const schema = table.schema
      const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
      if (columnIndex === -1) {
        throw new OrchestrationError('not_found', `Column "${data.columnName}" not found`)
      }

      if (schema.columns.length <= 1) {
        throw new OrchestrationError('validation', 'Cannot delete the last column in a table')
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
        .where(
          and(
            eq(userTableDefinitions.id, data.tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      if (groupRemovedId) {
        await stripGroupExecutions(trx, data.tableId, [groupRemovedId], {
          expectedWorkspaceId: table.workspaceId,
        })
      }

      logger.info(`Deleted column "${actualName}" from table ${data.tableId}`, { requestId })

      return {
        def: { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now },
        stripKey: columnId,
      }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )

  const strip = () =>
    stripColumnDataInBackground(
      data.tableId,
      def.workspaceId,
      [stripKey],
      def.rowCount ?? 0,
      requestId
    )
  if (!options?.tx) strip()
  // Inside a caller's transaction the drop may still roll back, so the cells stay until it commits.
  else if (!options.callerStripsRows) options.tx.afterCommit(strip)
  return def
}

/**
 * Validates a constraint change against the column's stored data, and returns
 * the column with those constraints applied.
 *
 * Shared by every write that can carry constraints, for the reason the
 * duplicate scan and {@link countEmptyCells} are shared: three copies of these
 * rules is the drift that produced the original required-check bug. Applying
 * them in the same write as the change they accompany is what stops a combined
 * request from committing one half and then failing on the other.
 */
async function applyConstraints(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  column: ColumnDefinition,
  columnKey: string,
  data: { required?: boolean; unique?: boolean }
): Promise<ColumnDefinition> {
  if (data.required === undefined && data.unique === undefined) return column

  if (column.workflowGroupId) {
    throw new OrchestrationError(
      'validation',
      `Cannot change constraints on workflow-output column "${column.name}". Constraints aren't applicable to columns whose values come from workflow execution.`
    )
  }
  if (data.required === true && !column.required) {
    const emptyCount = await countEmptyCells(trx, tableId, workspaceId, columnKey)
    if (emptyCount > 0) {
      throw new OrchestrationError(
        'validation',
        `Cannot set column "${column.name}" as required: ${emptyCount} row(s) have null, missing, or empty values`
      )
    }
  }
  if (data.unique === true && !column.unique) {
    if (!columnTypeOf(column).supportsUnique) {
      throw new OrchestrationError(
        'validation',
        `Cannot set column "${column.name}" as unique: ${column.type} columns compare stored values that would allow only one row per value.`
      )
    }
    if (await hasDuplicateValues(trx, tableId, workspaceId, column)) {
      throw new OrchestrationError(
        'validation',
        `Cannot set column "${column.name}" as unique: duplicate values exist`
      )
    }
  }
  return {
    ...column,
    ...(data.required !== undefined ? { required: data.required } : {}),
    ...(data.unique !== undefined ? { unique: data.unique } : {}),
  }
}

/** Persists a column list as the table's schema and returns the updated definition. */
async function persistColumns(
  trx: DbTransaction,
  table: TableDefinition,
  columns: ColumnDefinition[]
): Promise<TableDefinition> {
  const updatedSchema: TableSchema = { ...table.schema, columns }
  const now = new Date()
  await trx
    .update(userTableDefinitions)
    .set({ schema: updatedSchema, updatedAt: now })
    .where(
      and(
        eq(userTableDefinitions.id, table.id),
        eq(userTableDefinitions.workspaceId, table.workspaceId)
      )
    )
  return { ...table, schema: updatedSchema, updatedAt: now }
}

/**
 * Whether any two rows share an equal value in this column.
 *
 * Shared by the constraint write, the retype's pre-validation and the workspace
 * source plan so they cannot drift — the same reason {@link countEmptyCells} is
 * shared. A retype
 * that sets `unique` in the same request has to run this against the values the
 * conversion is ABOUT to write, not the ones on disk: coercing `"5"` and `"5.0"`
 * to a number manufactures a duplicate that no pre-scan of the raw text sees.
 */
export async function hasDuplicateValues(
  trx: DbExecutor,
  tableId: string,
  workspaceId: string,
  column: ColumnDefinition
): Promise<boolean> {
  const columnKey = getColumnId(column)
  const storedValue = sql`${userTableRows.data}->>${columnKey}::text`
  const comparableValue = columnTextForEquality(storedValue, column)
  const duplicates = (await trx.execute(
    sql`SELECT ${comparableValue} AS val, count(*) AS cnt FROM ${userTableRows} WHERE table_id = ${tableId} AND workspace_id = ${workspaceId} AND ${userTableRows.data} ? ${columnKey} AND ${comparableValue} IS NOT NULL GROUP BY val HAVING count(*) > 1 LIMIT 1`
  )) as { val: string; cnt: number }[]
  return duplicates.length > 0
}

/**
 * Validates a pending rename against the schema it will land in, and returns
 * the renamed column.
 *
 * Exists so a rename can be folded into whatever OTHER column write a request
 * carries, inside that write's transaction. Each write is its own locked
 * transaction, so a standalone rename alongside one of them means either order
 * can commit and then fail — and since a rename is metadata-only (rows key on
 * the stable column id), there is nothing forcing it to be its own write.
 *
 * Returns the column unchanged when there is no rename to apply. Exported so
 * the collision and name-shape rules are testable without a transaction.
 */
export function applyPendingRename(
  columns: ColumnDefinition[],
  columnIndex: number,
  newName: string | undefined
): ColumnDefinition {
  const column = columns[columnIndex]
  if (newName === undefined || newName === column.name) return column

  if (!NAME_PATTERN.test(newName)) {
    throw new OrchestrationError(
      'validation',
      `Invalid column name "${newName}". Column names must start with a letter or underscore, followed by alphanumeric characters or underscores.`
    )
  }
  if (newName.length > TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH) {
    throw new OrchestrationError(
      'validation',
      `Column name exceeds maximum length (${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters)`
    )
  }
  if (columns.some((c, i) => i !== columnIndex && c.name.toLowerCase() === newName.toLowerCase())) {
    throw new OrchestrationError('validation', `Column "${newName}" already exists`)
  }
  return { ...column, name: newName }
}

/**
 * What a retype must write back for one already-compatible cell, or `null` when
 * the stored value is already the value the new type should hold.
 *
 * A blank the target CANNOT read becomes null — the write path turns an
 * unreadable value into null on an optional column, so the conversion does the
 * same. A blank the target CAN read (`''` in a `string` or `json` column) is
 * left exactly as stored: nulling it would silently destroy the cell, and on a
 * `required` target it would leave a null behind a constraint that just passed
 * (`countEmptyCells` does not treat `''` as empty).
 *
 * Everything else goes through the target's `coerce`, which frequently
 * transforms the value — `$1,234.56` becomes `1234.56`. Without writing the
 * transformed value back, the cell keeps its old bytes under the new type,
 * and the type's `jsonbCast` can fail on every filter or sort.
 */
export function retypeCellRewrite(
  value: unknown,
  target: ColumnDefinition
): { value: JsonValue } | null {
  if (value === null || value === undefined) return null

  const effective = value as JsonValue

  if (!isValueCompatibleWithColumn(effective, target)) {
    // Incompatible non-blanks never reach here: the compatibility scan already
    // refused the whole conversion for them.
    return effective === '' ? { value: null } : null
  }

  const coerced = columnTypeById(target.type).coerce(effective, target)
  if (coerced.ok && !Object.is(coerced.value, value)) return { value: coerced.value }
  return null
}

/**
 * The column definition a retype produces: prior per-type metadata dropped,
 * then only what the TARGET type declares it owns carried forward, then that
 * type's own defaults stamped on.
 */
function buildConvertedColumn(
  column: ColumnDefinition,
  data: UpdateColumnTypeData,
  { isSelectType, targetMultiple }: { isSelectType: boolean; targetMultiple: boolean }
): ColumnDefinition {
  // Strip EVERY type-specific key generically, so a future type's metadata
  // cannot ride through `...rest` onto a target that does not own it — which
  // `validateColumnDefinition` would then reject on every later write.
  const rest = omit(column, [...TYPE_SPECIFIC_COLUMN_KEYS]) as ColumnDefinition
  // Constraints arriving with the retype are APPLIED here, not left to a second
  // transaction. `updateColumnType` already validates against them (empty cells
  // for `required`, post-conversion duplicates for `unique`), so applying them
  // in the same write is what makes a combined request all-or-nothing.
  const withConstraints: ColumnDefinition = {
    ...rest,
    ...(data.required !== undefined ? { required: data.required } : {}),
    ...(data.unique !== undefined ? { unique: data.unique } : {}),
  }

  if (isSelectType) {
    return {
      ...withConstraints,
      type: data.newType,
      options: data.options ?? column.options,
      ...(targetMultiple ? { multiple: true } : {}),
      // Select columns carry no unique constraint: it would compare the stored
      // option id, capping each option at one row table-wide, and the UI hides
      // the toggle so it could never be cleared again. Dropped here rather than
      // in each caller — the sidebar was the only one clearing it, leaving the
      // v1 and agent paths to strand it.
      unique: false,
    }
  }

  // Then carry back only the keys the TARGET type declares it owns, preferring
  // the value this request supplied over the column's existing one. Iterating
  // the key list rather than naming keys is what keeps this zero-edit for a
  // future type.
  const definition = columnTypeById(data.newType)
  const owned = new Set<string>(definition.ownedMetadata)
  const carried: ColumnDefinition = { ...withConstraints, type: data.newType }
  for (const key of TYPE_SPECIFIC_COLUMN_KEYS) {
    if (!owned.has(key)) continue
    const value = data[key] ?? column[key]
    if (value !== undefined) Object.assign(carried, { [key]: value })
  }
  return { ...carried, ...definition.defaultMetadata?.(carried) }
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
  requestId: string,
  options?: ColumnMutationOptions
): Promise<TableDefinition> {
  return withLockedTable(
    data.tableId,
    async (table, trx) => {
      // Retype reinterprets every stored value under a new type — destructive.
      assertColumnDestructive(table)
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
        throw new OrchestrationError(
          'validation',
          `Invalid column type "${data.newType}". Valid types: ${COLUMN_TYPES.join(', ')}`
        )
      }

      const schema = table.schema
      const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
      if (columnIndex === -1) {
        throw new OrchestrationError('not_found', `Column "${data.columnName}" not found`)
      }

      const column = schema.columns[columnIndex]
      if (column.type === data.newType) {
        // Callers gate on the type actually changing, but they compute that from
        // a schema read taken before this transaction took the lock — so a
        // concurrent change can land us here with real work still to do. Only a
        // rename can be honoured without a conversion; anything else would be
        // silently discarded, and answering success for a change that never
        // happened is the worst outcome available.
        const carriesOtherWork =
          data.required !== undefined ||
          data.unique !== undefined ||
          data.options !== undefined ||
          data.multiple !== undefined ||
          data.currencyCode !== undefined
        if (carriesOtherWork) {
          throw new OrchestrationError(
            'validation',
            `Column "${column.name}" is already type "${data.newType}"; re-issue the request without a type change.`
          )
        }
        const renamed = applyPendingRename(schema.columns, columnIndex, data.newName)
        if (renamed === column) return table
        return persistColumns(
          trx,
          table,
          schema.columns.map((c, i) => (i === columnIndex ? renamed : c))
        )
      }
      const columnKey = getColumnId(column)

      const isSelectType = data.newType === 'select'
      const targetMultiple = data.multiple ?? column.multiple
      // Leaving `select` behind: stored cells hold option ids, which mean nothing
      // once the column is text/number/etc. Check compatibility against the option
      // NAME — that's what the cell will actually become (migrated below).
      const convertingAwayFromSelect = column.type === 'select' && !isSelectType
      // The constraint the column ends up with, which may be arriving in this
      // same request — this write applies it, so the scan below has to judge
      // against the target value rather than the current one.
      const targetRequired = !!(data.required ?? column.required)

      // Rows missing the key (or holding null/`[]`) are filtered out of `rows`
      // entirely, so the loop below can never see them — they have to be counted
      // separately, through the same predicate `applyConstraints` uses.
      if (targetRequired) {
        const emptyCount = await countEmptyCells(trx, data.tableId, table.workspaceId, columnKey)
        if (emptyCount > 0) {
          throw new OrchestrationError(
            'validation',
            `Cannot change column "${column.name}" to a required "${data.newType}": ${emptyCount} row(s) have null, missing, or empty values. Fill them first, or apply the type change without making the column required.`
          )
        }
      }

      /**
       * The column definition the table ends up with. Built before the scan so
       * the coercion below reads the same metadata (option set, currency) the
       * stored value will be validated against afterwards.
       */
      const convertedColumn = buildConvertedColumn(column, data, {
        isSelectType,
        targetMultiple: !!targetMultiple,
      })
      const renamedColumns = schema.columns.map((c, i) => (i === columnIndex ? convertedColumn : c))
      const updatedColumns = renamedColumns.map((c, i) =>
        i === columnIndex ? applyPendingRename(renamedColumns, columnIndex, data.newName) : c
      )
      const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
      assertValidSchema(updatedSchema, table.metadata?.columnOrder)

      let incompatibleCount = 0
      let blankCount = 0
      /**
       * Compatibility scan, paged so a wide table cannot pull every row into
       * memory at once. Only counts here — the values the cells must END UP
       * holding are derived in the rewrite pass below, which reads the rows
       * back after `migrationFrom` has run so a `select` source is already in
       * its option-name form. See {@link retypeCellRewrite}.
       */
      const retypeScanBatchSize = getColumnRetypeScanBatchSize()
      let validationAfterId: string | undefined
      while (true) {
        const rows = await readColumnRetypePage(
          trx,
          data.tableId,
          table.workspaceId,
          columnKey,
          retypeScanBatchSize,
          validationAfterId
        )
        if (rows.length === 0) break
        for (const row of rows) {
          const value = row.value
          if (value === null || value === undefined) continue

          const effective = convertingAwayFromSelect
            ? selectValueForConversion(column, value)
            : value

          if (!isValueCompatibleWithColumn(effective, convertedColumn)) {
            if (effective === null || effective === '') {
              if (targetRequired) blankCount++
            } else {
              incompatibleCount++
            }
          }
        }
        validationAfterId = rows.at(-1)?.id
        if (rows.length < retypeScanBatchSize) break
      }

      if (blankCount > 0) {
        throw new OrchestrationError(
          'validation',
          `Cannot change column "${column.name}" to a required "${data.newType}": ${blankCount} row(s) are empty. Fill them first, or apply the type change without making the column required.`
        )
      }

      if (incompatibleCount > 0) {
        throw new OrchestrationError(
          'validation',
          `Cannot change column "${column.name}" to type "${data.newType}": ${incompatibleCount} row(s) have incompatible values. Fix or remove the incompatible values first.`
        )
      }

      const columnValidation = validateColumnDefinition(updatedColumns[columnIndex])
      if (!columnValidation.valid) {
        throw new OrchestrationError(
          'validation',
          `Invalid column: ${columnValidation.errors.join('; ')}`
        )
      }

      const now = new Date()

      // Cell rewrites are owned by the column-type registry, keyed by direction.
      // Outbound runs first: leaving `select` turns opaque option ids into names,
      // which is the form the inbound migration (if any) then reads.
      const migrationContext = {
        trx,
        tableId: data.tableId,
        workspaceId: table.workspaceId,
        columnKey,
        previous: column,
        target: updatedColumns[columnIndex],
        resolved: new Map<string, JsonValue>(),
      }
      await migrationFrom(column.type)?.(migrationContext)
      if (!isSelectType) {
        let rewriteAfterId: string | undefined
        while (true) {
          const rows = await readColumnRetypePage(
            trx,
            data.tableId,
            table.workspaceId,
            columnKey,
            retypeScanBatchSize,
            rewriteAfterId
          )
          if (rows.length === 0) break
          const coercedByRowId = new Map<string, JsonValue>()
          for (const row of rows) {
            const rewrite = retypeCellRewrite(row.value, convertedColumn)
            if (rewrite) coercedByRowId.set(row.id, rewrite.value)
          }
          await writeBackCoercedCells(
            trx,
            data.tableId,
            table.workspaceId,
            columnKey,
            coercedByRowId
          )
          rewriteAfterId = rows.at(-1)?.id
          if (rows.length < retypeScanBatchSize) break
        }
      }
      if (isSelectType) {
        await migrationTo(data.newType)?.(migrationContext)
      }

      // A `unique` arriving with this retype is validated HERE, against the values
      // the conversion just wrote — not by the separate constraint write that
      // follows. The conversion itself manufactures duplicates that no scan of the
      // pre-conversion data can see (`"5"` and `"5.0"` both coerce to `5`), and
      // that write runs in its own transaction, so discovering it there would
      // report an error with the retype already committed and the original text
      // irrecoverably rewritten.
      if (data.unique === true && !column.unique) {
        if (await hasDuplicateValues(trx, data.tableId, table.workspaceId, convertedColumn)) {
          throw new OrchestrationError(
            'validation',
            `Cannot change column "${column.name}" to type "${data.newType}" and set it as unique: the converted values contain duplicates.`
          )
        }
      }

      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, updatedAt: now })
        .where(
          and(
            eq(userTableDefinitions.id, data.tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      logger.info(
        `Changed column "${column.name}" type from "${column.type}" to "${data.newType}" in table ${data.tableId}`,
        { requestId }
      )

      return { ...table, schema: updatedSchema, updatedAt: now }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
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
  requestId: string,
  options?: ColumnMutationOptions
): Promise<TableDefinition> {
  return withLockedTable(
    data.tableId,
    async (table, trx) => {
      assertSchemaMutable(table)
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
        throw new OrchestrationError('not_found', `Column "${data.columnName}" not found`)
      }

      const column = schema.columns[columnIndex]
      const columnKey = getColumnId(column)
      const constrained = await applyConstraints(
        trx,
        data.tableId,
        table.workspaceId,
        column,
        columnKey,
        data
      )
      const withConstraints = schema.columns.map((c, i) => (i === columnIndex ? constrained : c))
      const updatedColumns = withConstraints.map((c, i) =>
        i === columnIndex ? applyPendingRename(withConstraints, columnIndex, data.newName) : c
      )
      const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
      const now = new Date()

      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, updatedAt: now })
        .where(
          and(
            eq(userTableDefinitions.id, data.tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      logger.info(`Updated constraints for column "${column.name}" in table ${data.tableId}`, {
        requestId,
      })

      return { ...table, schema: updatedSchema, updatedAt: now }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
}

/**
 * Updates the option set (and optional single/multi mode) of a `select` column
 * without changing its type.
 *
 * Lock gating is split, because the payload decides how destructive the write
 * is. Every call changes the schema, so `assertSchemaMutable` always runs. A
 * payload that DROPS options additionally rewrites `user_table_rows.data` (see
 * {@link clearRemovedSelectOptions}) — exactly the cell destruction the delete
 * lock exists to refuse — so that case escalates to `assertColumnDestructive`.
 * Adding, reordering, or renaming options and toggling `multiple` never clear a
 * cell (a multi→single toggle refuses rather than truncates), so gating those on
 * the delete lock would block a non-destructive edit.
 */
export async function updateColumnOptions(
  data: UpdateColumnOptionsData,
  requestId: string,
  options?: ColumnMutationOptions
): Promise<TableDefinition> {
  return withLockedTable(
    data.tableId,
    async (table, trx) => {
      assertSchemaMutable(table)

      const schema = table.schema
      const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
      if (columnIndex === -1) {
        throw new OrchestrationError('not_found', `Column "${data.columnName}" not found`)
      }

      const column = schema.columns[columnIndex]
      if (column.type !== 'select') {
        throw new OrchestrationError(
          'validation',
          `Cannot set options on column "${column.name}" of type "${column.type}"`
        )
      }

      const columnKey = getColumnId(column)

      const { multiple: _prevMultiple, ...columnRest } = column
      const updatedColumn = {
        ...columnRest,
        options: data.options,
        ...((data.multiple ?? column.multiple) ? { multiple: true } : {}),
      }
      const columnValidation = validateColumnDefinition(updatedColumn)
      if (!columnValidation.valid) {
        throw new OrchestrationError(
          'validation',
          `Invalid column: ${columnValidation.errors.join('; ')}`
        )
      }

      const nextMultiple = !!(data.multiple ?? column.multiple)
      const wasMultiple = !!column.multiple
      const keptIds = new Set(data.options.map((o) => o.id))
      const removedAny = (column.options ?? []).some((o) => !keptIds.has(o.id))
      const togglingCardinality = nextMultiple !== wasMultiple
      // The constraint the column ENDS UP with, which may be arriving in this same
      // request. `applyConstraints` validates and applies it below, after the cell
      // migrations; the checks in between need to read the target value.
      const targetRequired = !!(data.required ?? column.required)

      // Dropping an option is a row-data rewrite, not a schema-only edit.
      if (removedAny) assertColumnDestructive(table)

      if (togglingCardinality || removedAny) {
        const timeoutMs = scaledStatementTimeoutMs(table.rowCount ?? 0, {
          baseMs: 60_000,
          perRowMs: 2,
        })
        await setTableTxTimeouts(trx, { statementMs: timeoutMs, idleMs: timeoutMs })
      }

      // Removal runs FIRST, before the multi→single guard and the shape migration.
      // Both of those read the cells: the guard would otherwise count options this
      // same request is dropping, and the migration keeps a multi cell's FIRST
      // element — which could be a removed id sitting ahead of a kept one, so the
      // surviving option would be discarded and the dead one kept.
      //
      // Cells are still in their pre-toggle shape here, so this passes the CURRENT
      // cardinality, not the target one.
      if (removedAny) {
        // On a required column, clearing is not an option: it would leave rows the
        // write path rejects, and `updateColumnConstraints` refuses to CREATE that
        // state, so producing it here would be inconsistent. Make the caller
        // reassign those rows first.
        //
        // Gated on the constraint the column ENDS UP with, which may be arriving
        // in this same request: validating against the current flag both blocks a
        // removal paired with `required: false` that is about to be fine, and lets
        // a removal paired with `required: true` clear cells and then fail the
        // constraint write, leaving this change committed behind an error.
        if (targetRequired) {
          const strandedCount = await countCellsLosingTheirOptions(
            trx,
            data.tableId,
            table.workspaceId,
            columnKey,
            data.options,
            wasMultiple
          )
          if (strandedCount > 0) {
            throw new OrchestrationError(
              'validation',
              `Cannot remove options from required column "${column.name}": ${strandedCount} row(s) would be left empty. Reassign those rows to a remaining option first.`
            )
          }
        }
        await clearRemovedSelectOptions(
          trx,
          data.tableId,
          table.workspaceId,
          columnKey,
          data.options,
          wasMultiple
        )
      }

      // Switching multiple → single drops all but the first option in any cell
      // that still holds several — block it rather than silently losing data.
      // Counted after the removal above, so dropping surplus options and turning
      // multiselect off in one save is allowed when every cell ends up with one.
      if (wasMultiple && !nextMultiple) {
        const multiValuedCount = await countMultiValuedCells(
          trx,
          data.tableId,
          table.workspaceId,
          columnKey
        )

        if (multiValuedCount > 0) {
          throw new OrchestrationError(
            'validation',
            `Cannot switch column "${column.name}" to single-select: ${multiValuedCount} row(s) have multiple options selected. Reduce them to one option first.`
          )
        }
      }

      // A single↔multi toggle changes the stored shape (scalar id vs array of
      // ids). Multi filters compile to array containment, which never matches a
      // scalar, so leaving cells un-normalized would silently drop every
      // pre-toggle row out of its own column's filters.
      if (togglingCardinality) {
        // Same registry migration the retype path uses — `updatedColumn` already
        // carries the post-toggle `options`/`multiple`, which is all it reads.
        await migrationTo('select')?.({
          trx,
          tableId: data.tableId,
          workspaceId: table.workspaceId,
          columnKey,
          previous: column,
          target: updatedColumn,
          resolved: new Map(),
        })
      }

      // Constraints are validated and applied AFTER the migrations above, because
      // those migrations rewrite stored values — a `unique` scan run before them
      // would read the pre-migration shape and pass, and the migration could then
      // produce the duplicates it was meant to prevent.
      const constrainedColumn = await applyConstraints(
        trx,
        data.tableId,
        table.workspaceId,
        updatedColumn,
        columnKey,
        data
      )
      const withOptions = schema.columns.map((c, i) => (i === columnIndex ? constrainedColumn : c))
      const updatedColumns = withOptions.map((c, i) =>
        i === columnIndex ? applyPendingRename(withOptions, columnIndex, data.newName) : c
      )

      const updated = await persistColumns(trx, table, updatedColumns)

      logger.info(`Updated options for column "${column.name}" in table ${data.tableId}`, {
        requestId,
      })

      return updated
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
}

/**
 * Changes the currency a `currency` column renders in.
 *
 * Deliberately the cheapest column mutation in this module: cells store a bare
 * number, so re-denominating a column touches only the schema — no row rewrite,
 * no compatibility scan, no scaled timeouts. It notably does **not** convert
 * amounts between currencies; `1000` stays `1000`, now labelled in the new code.
 *
 * @param data - Column + target ISO 4217 code
 * @param requestId - Request ID for logging
 * @returns Updated table definition
 * @throws Error if the table or column is missing, or the column is not a currency column
 */
export async function updateColumnCurrency(
  data: UpdateColumnCurrencyData,
  requestId: string,
  options?: ColumnMutationOptions
): Promise<TableDefinition> {
  return withLockedTable(
    data.tableId,
    async (table, trx) => {
      assertSchemaMutable(table)

      const schema = table.schema
      const columnIndex = schema.columns.findIndex((c) => columnMatchesRef(c, data.columnName))
      if (columnIndex === -1) {
        throw new OrchestrationError('not_found', `Column "${data.columnName}" not found`)
      }

      const column = schema.columns[columnIndex]
      if (column.type !== 'currency') {
        throw new OrchestrationError(
          'validation',
          `Cannot set currency on column "${column.name}" of type "${column.type}"`
        )
      }

      const updatedColumn: ColumnDefinition = {
        ...column,
        currencyCode: resolveCurrencyCode(data.currencyCode),
      }
      const columnValidation = validateColumnDefinition(updatedColumn)
      if (!columnValidation.valid) {
        throw new OrchestrationError(
          'validation',
          `Invalid column: ${columnValidation.errors.join('; ')}`
        )
      }

      const constrained = await applyConstraints(
        trx,
        data.tableId,
        table.workspaceId,
        updatedColumn,
        getColumnId(column),
        data
      )

      // Only a no-op when nothing at all changed — currency, constraints, name.
      const renamePending = data.newName !== undefined && data.newName !== column.name
      if (
        constrained === updatedColumn &&
        updatedColumn.currencyCode === column.currencyCode &&
        !renamePending
      ) {
        return table
      }

      const withCurrency = schema.columns.map((c, i) => (i === columnIndex ? constrained : c))
      const updatedColumns = withCurrency.map((c, i) =>
        i === columnIndex ? applyPendingRename(withCurrency, columnIndex, data.newName) : c
      )
      const updatedSchema: TableSchema = { ...schema, columns: updatedColumns }
      const now = new Date()

      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, updatedAt: now })
        .where(
          and(
            eq(userTableDefinitions.id, data.tableId),
            eq(userTableDefinitions.workspaceId, table.workspaceId)
          )
        )

      logger.info(
        `Set currency for column "${column.name}" to "${updatedColumn.currencyCode}" in table ${data.tableId}`,
        { requestId }
      )

      return { ...table, schema: updatedSchema, updatedAt: now }
    },
    { expectedWorkspaceId: options?.expectedWorkspaceId, tx: options?.tx }
  )
}

/**
 * Rows whose cell in `columnKey` counts as empty for a `required` constraint: the key is
 * missing, the value is JSON null, or it is an emptied multiselect `[]`.
 *
 * Single source of truth for `updateColumnType`'s pre-flight, `updateColumnConstraints` and the
 * workspace source plan: the first two run in separate transactions, so diverging definitions
 * would let a type+required change commit the conversion and then fail the constraint.
 */
export async function countEmptyCells(
  trx: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKey: string
): Promise<number> {
  const [result] = await trx
    .select({ count: count() })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`(NOT (${userTableRows.data} ? ${columnKey})
             OR ${userTableRows.data}->>${columnKey}::text IS NULL
             OR ${userTableRows.data}->${columnKey}::text = '[]'::jsonb)`
      )
    )
  return result?.count ?? 0
}

/**
 * Rows holding a value in each of `columnKeys` (the cells deleting that column would lose), in one
 * pass over the table's rows: column key → filled cells.
 */
export async function countFilledCellsByColumn(
  executor: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKeys: readonly string[]
): Promise<Map<string, number>> {
  if (columnKeys.length === 0) return new Map()
  const filled = (columnKey: string) =>
    sql<number>`count(*) filter (where ${userTableRows.data} ? ${columnKey} and ${userTableRows.data}->>${columnKey}::text is not null and ${userTableRows.data}->${columnKey}::text <> '[]'::jsonb)`.mapWith(
      Number
    )
  const [row] = await executor
    .select(
      Object.fromEntries(columnKeys.map((columnKey, index) => [`c${index}`, filled(columnKey)]))
    )
    .from(userTableRows)
    .where(and(eq(userTableRows.tableId, tableId), eq(userTableRows.workspaceId, workspaceId)))
  return new Map(columnKeys.map((columnKey, index) => [columnKey, row?.[`c${index}`] ?? 0]))
}

/**
 * Rows that removing these options would leave with no selection at all — a
 * single cell holding a removed id, or a multi cell whose every element is
 * being removed. Rows that keep at least one option are unaffected.
 */
export async function countCellsLosingTheirOptions(
  trx: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[],
  multiple: boolean
): Promise<number> {
  const keptIds = JSON.stringify(options.map((o) => o.id))

  if (multiple) {
    const [result] = await trx
      .select({ count: count() })
      .from(userTableRows)
      .where(
        and(
          eq(userTableRows.tableId, tableId),
          eq(userTableRows.workspaceId, workspaceId),
          sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'array'`,
          sql`${userTableRows.data}->${columnKey}::text <> '[]'::jsonb`,
          // The type guard above is not ordered against this predicate, so the
          // element expansion has to guard its own argument — otherwise a scalar
          // cell left over from a single→multi toggle raises "cannot get array
          // length of a scalar" before the guard is ever applied.
          sql`NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'array'
                       THEN ${userTableRows.data}->${columnKey}::text ELSE '[]'::jsonb END
                ) e
                WHERE ${keptIds}::jsonb @> jsonb_build_array(e)
              )`
        )
      )
    return result?.count ?? 0
  }

  const [result] = await trx
    .select({ count: count() })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'string'`,
        sql`${userTableRows.data}->>${columnKey}::text <> ''`,
        sql`NOT (${keptIds}::jsonb @> jsonb_build_array(${userTableRows.data}->${columnKey}::text))`
      )
    )
  return result?.count ?? 0
}

/**
 * The rows whose `columnKey` cell holds an option outside `options`: a single cell holding a
 * removed id, or a multi cell holding one or more. {@link clearRemovedSelectOptions} rewrites
 * exactly these rows and {@link countCellsLosingAnOption} counts them, so a plan's count is the
 * write's.
 */
function rowsHoldingRemovedOptions(
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[],
  multiple: boolean
) {
  const keptIds = JSON.stringify(options.map((o) => o.id))
  const cell = sql`${userTableRows.data}->${columnKey}::text`
  return and(
    eq(userTableRows.tableId, tableId),
    eq(userTableRows.workspaceId, workspaceId),
    ...(multiple
      ? [sql`jsonb_typeof(${cell}) = 'array'`, sql`NOT (${keptIds}::jsonb @> (${cell}))`]
      : [
          sql`jsonb_typeof(${cell}) = 'string'`,
          sql`${userTableRows.data}->>${columnKey}::text <> ''`,
          sql`NOT (${keptIds}::jsonb @> jsonb_build_array(${cell}))`,
        ])
  )
}

/**
 * Rows whose cell loses at least one selection when every option but `options` is removed: a
 * multi cell keeping some of its options counts too, unlike {@link countCellsLosingTheirOptions}.
 */
export async function countCellsLosingAnOption(
  executor: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[],
  multiple: boolean
): Promise<number> {
  const [result] = await executor
    .select({ count: count() })
    .from(userTableRows)
    .where(rowsHoldingRemovedOptions(tableId, workspaceId, columnKey, options, multiple))
  return result?.count ?? 0
}

/**
 * Rows whose multi-select cell holds more than one option, counting only the ids of `kept` when
 * given (the options a removal in the same change leaves). Switching the column to single-select
 * is refused while any exist.
 */
export async function countMultiValuedCells(
  executor: DbExecutor,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  kept?: SelectOption[]
): Promise<number> {
  const cell = sql`${userTableRows.data}->${columnKey}::text`
  const selected = kept
    ? sql`(SELECT count(*) FROM jsonb_array_elements(${cell}) AS e(v)
           WHERE ${JSON.stringify(kept.map((o) => o.id))}::jsonb @> jsonb_build_array(e.v))`
    : sql`jsonb_array_length(${cell})`
  const [result] = await executor
    .select({ count: count() })
    .from(userTableRows)
    .where(
      and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`CASE WHEN jsonb_typeof(${cell}) = 'array' THEN ${selected} > 1 ELSE false END`
      )
    )
  return result?.count ?? 0
}

/**
 * Clears stored ids that are no longer in a `select` column's option set.
 *
 * A single cell holding a removed option becomes null; a multi cell drops just
 * the removed elements. Kept set-based off a jsonb array of the surviving ids.
 */
async function clearRemovedSelectOptions(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[],
  multiple: boolean
): Promise<void> {
  const keptIds = JSON.stringify(options.map((o) => o.id))
  const rowWhere = rowsHoldingRemovedOptions(tableId, workspaceId, columnKey, options, multiple)
  if (!rowWhere) return

  if (multiple) {
    await updateTableRowsWithDerivedSecretProvenance(trx, {
      rowWhere,
      transformation: {
        mode: 'preserve',
        dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text], COALESCE((
          SELECT jsonb_agg(e.v ORDER BY e.ord)
          FROM jsonb_array_elements(${userTableRows.data}->${columnKey}::text)
            WITH ORDINALITY AS e(v, ord)
          WHERE ${keptIds}::jsonb @> jsonb_build_array(e.v)
        ), '[]'::jsonb))`,
      },
    })
    return
  }

  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere,
    transformation: {
      mode: 'preserve',
      dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text], 'null'::jsonb)`,
    },
  })
}

/**
 * The value a `select` cell becomes when its column converts to another type:
 * the option **name**, since the stored id is meaningless outside the column.
 * Multi-select flattens to a comma-joined string — the same shape a multi cell
 * exports as — and an empty or fully-orphaned cell becomes null.
 */
export function selectValueForConversion(column: ColumnDefinition, value: unknown): JsonValue {
  const names = selectValueToNames(column, value)
  if (Array.isArray(names)) return names.length > 0 ? names.join(', ') : null
  return names
}

/**
 * Checks a value against the column definition the table will end up with.
 *
 * Takes the whole target column rather than loose per-type arguments: the gate
 * has to read the SAME metadata the later coercion does, and a hand-built stub
 * silently omits whatever key its author did not think of. Today that key would
 * be `currencyCode` — a three-decimal column reads `0,500` as a half dinar
 * while a stub without the code reads it as five hundred.
 *
 * That divergence is currently invisible, because whether an amount parses at
 * all does not depend on the currency, only which number it yields — and the
 * write-back already coerces against the real column. Passing the real column
 * here means it cannot become visible when that stops being true.
 *
 * Callers converting *away* from `select` must pass the resolved option
 * name(s), not the stored ids — see {@link selectValueForConversion}.
 */
export function isValueCompatibleWithColumn(value: unknown, target: ColumnDefinition): boolean {
  if (value === null || value === undefined) return true
  // Each type reads only the metadata it owns.
  return isValueCompatible(value, target)
}
