import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { userTableDefinitions } from '@sim/db/schema'
import { omit } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  type AddTableColumnInput,
  columnAddedAudit,
  columnDeletedAudit,
  columnUpdatedAudit,
  type UpdateTableColumnInput,
} from '@/lib/table/application/columns'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { throwTableOperationFailure } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'
import {
  type AppliedTableUpdate,
  resolveFolderInput,
  type TableFieldsInput,
  type TableFieldsProgress,
  tableFieldAudits,
  writeTableFields,
} from '@/lib/table/application/tables'
import { assertRowCapacity, notifyTableRowUsage } from '@/lib/table/billing'
import { buildIdByName, columnMatchesRef, rowDataNameToId } from '@/lib/table/column-keys'
import { columnTypeById } from '@/lib/table/column-types'
import { addTableColumn, deleteColumn } from '@/lib/table/columns/service'
import { signalTableRowsChanged, signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { replaceTableRowsWithTx } from '@/lib/table/rows/service'
import { withTableWriteTx } from '@/lib/table/service'
import type {
  ColumnDefinition,
  ReplaceRowsResult,
  RowData,
  TableDefinition,
  TableMetadata,
  TableSourceRows,
} from '@/lib/table/types'

/** One column update of a reshape, addressed by column id (or name). */
interface ReshapeColumnUpdate {
  columnName: string
  updates: UpdateTableColumnInput['updates']
}

export interface ReshapeTableInput {
  tableId: string
  workspaceId: string
  /** The table's own fields to set; an absent field is left alone. */
  table?: TableFieldsInput
  /** Columns to drop, by id (or name). */
  drop?: string[]
  update?: ReshapeColumnUpdate[]
  add?: AddTableColumnInput['column'][]
  /**
   * Rows, keyed by column name as the reshape leaves the columns, that replace every row of the
   * table in the same transaction: workspace source's managed or seed rows. A cell naming no
   * column is dropped.
   */
  replaceRows?: RowData[]
  /**
   * Marks the rows as managed by workspace source, matched by the column named `keyColumn` as the
   * reshape leaves the columns (`null` clears the mark); absent leaves it alone.
   */
  sourceRows?: { mode: 'managed'; keyColumn: string } | null
}

export interface ReshapeTableResult {
  table: TableDefinition
  /** The table fields that changed. */
  changed: AppliedTableUpdate[]
  /** What replacing the rows deleted and inserted, when the input replaced them. */
  replaced?: ReplaceRowsResult
}

/** The managed-rows mark of `input`, by the id of its key column; `null` clears it. */
function sourceRowsMark(
  input: NonNullable<ReshapeTableInput['sourceRows']> | null,
  idByName: ReadonlyMap<string, string>
): TableSourceRows | null {
  if (!input) return null
  const keyColumnId = idByName.get(input.keyColumn)
  if (!keyColumnId) {
    throw new OrchestrationError('validation', `Column "${input.keyColumn}" does not exist`)
  }
  return { mode: 'managed', keyColumnId }
}

/** `metadata` with the managed-rows marker set to `sourceRows`, or removed for `null`. */
function withSourceRows(
  metadata: TableMetadata | null | undefined,
  sourceRows: TableSourceRows | null
): TableMetadata {
  const rest = omit(metadata ?? {}, ['sourceRows'])
  return sourceRows ? { ...rest, sourceRows } : rest
}

/** A column name no column of `table` holds, to park a column under during a rename cycle. */
function freeColumnName(table: TableDefinition): string {
  const taken = new Set(table.schema.columns.map((column) => column.name.toLowerCase()))
  let index = 1
  while (taken.has(`_reshape_${index}`)) index += 1
  return `_reshape_${index}`
}

/**
 * Applies column updates so each rename finds its target name free and each retype onto a type a
 * table may hold only so many of (`maxPerTable`) finds a slot. An update whose new name a column
 * with its own pending rename still holds waits for that rename; an update onto a capped type
 * waits while another pending update still moves a column off it. When every update waits (a
 * swap, or any longer rename cycle), a column another update waits on for its name is parked
 * under a free name first, which unblocks that update. A name held by a column that is not being
 * renamed, or a capped type no pending update frees, is left to the update to refuse.
 */
async function updateColumns(
  table: TableDefinition,
  updates: readonly ReshapeColumnUpdate[],
  update: (
    table: TableDefinition,
    columnName: string,
    updates: ReshapeColumnUpdate['updates']
  ) => Promise<TableDefinition>
): Promise<TableDefinition> {
  const pending = [...updates]
  let current = table
  const renaming = (column: ColumnDefinition) =>
    pending.some(
      (entry) => entry.updates.name !== undefined && columnMatchesRef(column, entry.columnName)
    )
  const columnOf = (entry: ReshapeColumnUpdate) =>
    current.schema.columns.find((column) => columnMatchesRef(column, entry.columnName))
  /** The column holding the name `entry` renames to, when that column is itself being renamed. */
  const blockerOf = (entry: ReshapeColumnUpdate) => {
    const name = entry.updates.name?.toLowerCase()
    if (name === undefined) return undefined
    const holder = current.schema.columns.find(
      (column) => column.name.toLowerCase() === name && !columnMatchesRef(column, entry.columnName)
    )
    return holder && renaming(holder) ? holder : undefined
  }
  /** Whether `entry` retypes onto a capped type another pending update still moves a column off. */
  const awaitsTypeSlot = (entry: ReshapeColumnUpdate) => {
    const type = entry.updates.type
    if (type === undefined || columnTypeById(type).maxPerTable === undefined) return false
    if (columnOf(entry)?.type === type) return false
    return pending.some(
      (other) =>
        other !== entry &&
        other.updates.type !== undefined &&
        other.updates.type !== type &&
        columnOf(other)?.type === type
    )
  }
  while (pending.length > 0) {
    const ready = pending.findIndex(
      (entry) => blockerOf(entry) === undefined && !awaitsTypeSlot(entry)
    )
    if (ready === -1) {
      const blockers = pending.map(blockerOf)
      const parked = pending.find((entry) =>
        blockers.some((blocker) => blocker && columnMatchesRef(blocker, entry.columnName))
      )
      if (parked) {
        current = await update(current, parked.columnName, { name: freeColumnName(current) })
        continue
      }
    }
    // With nothing ready and no rename to park, capped types only free each other: the first
    // update runs and refuses.
    const [next] = pending.splice(Math.max(ready, 0), 1)
    current = await update(current, next.columnName, next.updates)
  }
  return current
}

/**
 * Reshapes a table in one transaction: its own name, description and folder, then column drops,
 * updates (renames ordered so each finds its name free) and adds. Each step is the same service
 * write the single-column use cases run, with the same lock checks and validation, joined to one
 * transaction under the table's schema lock: a failure at any step commits nothing. Audits one
 * entry per change, as the single use cases would.
 */
export const reshapeTableUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.reshape,
  resolveContext: ({ input }: { input: ReshapeTableInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }): Promise<ReshapeTableResult> {
    const { workspaceId } = context
    const resolution = await resolveFolderInput(workspaceId, input.table?.folderPath)
    const { attributedUserId } = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const requestId = generateRequestId()
    // Checked before the transaction opens (it reads the billing pool): every row is replaced.
    const rowLimit = input.replaceRows
      ? await assertRowCapacity({
          workspaceId,
          currentRowCount: 0,
          addedRows: input.replaceRows.length,
        })
      : null
    const result = await withTableWriteTx(
      context.table.id,
      async (locked, tx) => {
        const options = { expectedWorkspaceId: workspaceId, tx }
        const progress: TableFieldsProgress = { current: locked, applied: [], changed: [] }
        if (input.table) await writeTableFields(progress, input.table, resolution?.folderId, tx)
        let table = progress.current
        for (const columnName of input.drop ?? []) {
          table = await deleteColumn({ tableId: table.id, columnName }, requestId, options)
        }
        table = await updateColumns(
          table,
          input.update ?? [],
          async (current, columnName, updates) => {
            const outcome = await performUpdateTableColumn({
              table: current,
              columnName,
              userId: attributedUserId,
              updates,
              requestId,
              expectedWorkspaceId: workspaceId,
              tx,
              recordAudit: false,
            })
            if (!outcome.success || !outcome.table) {
              throwTableOperationFailure(outcome, 'Failed to update column')
            }
            return outcome.table
          }
        )
        for (const column of input.add ?? []) {
          table = await addTableColumn(table.id, column, requestId, options)
        }
        const idByName = buildIdByName(table.schema)
        if (input.sourceRows !== undefined) {
          const metadata = withSourceRows(
            table.metadata,
            sourceRowsMark(input.sourceRows, idByName)
          )
          await tx.trx
            .update(userTableDefinitions)
            .set({ metadata })
            .where(
              and(
                eq(userTableDefinitions.id, table.id),
                eq(userTableDefinitions.workspaceId, workspaceId)
              )
            )
          table = { ...table, metadata }
        }
        const replaceRows = input.replaceRows?.map((row) => rowDataNameToId(row, idByName))
        const replaced = replaceRows
          ? await replaceTableRowsWithTx(
              tx.trx,
              {
                tableId: table.id,
                workspaceId,
                rows: replaceRows,
                userId: attributedUserId,
                secretProvenance: replaceRows.map(createExactEmptyTableRowSecretProvenance),
              },
              table,
              requestId,
              { uncoercibleValues: 'reject' }
            )
          : undefined
        return { table, changed: progress.changed, ...(replaced ? { replaced } : {}) }
      },
      { expectedWorkspaceId: workspaceId }
    )
    if (rowLimit !== null && result.replaced) {
      notifyTableRowUsage({
        workspaceId,
        currentRowCount: 0,
        addedRows: result.replaced.insertedCount,
        limit: rowLimit,
      })
    }
    return result
  },
  projectAudit({ input, context, result }) {
    const before = context.table
    return [
      ...tableFieldAudits(before, input.table ?? {}, result.changed, result.table.name),
      ...(input.drop ?? []).map((columnName) =>
        columnDeletedAudit(before, result.table, columnName)
      ),
      ...(input.update ?? []).map(({ columnName, updates }) =>
        columnUpdatedAudit(before, result.table, columnName, updates)
      ),
      ...(input.add ?? []).map((column) => columnAddedAudit(before, result.table, column)),
      ...(result.replaced && (result.replaced.deletedCount > 0 || result.replaced.insertedCount > 0)
        ? [
            {
              action: AuditAction.TABLE_UPDATED,
              resourceType: AuditResourceType.TABLE,
              resourceId: result.table.id,
              resourceName: result.table.name,
              description: `Replaced rows in table "${result.table.name}"`,
              metadata: {
                op: 'replace_rows',
                rowsDeleted: result.replaced.deletedCount,
                rowsInserted: result.replaced.insertedCount,
              },
            },
          ]
        : []),
    ]
  },
  afterSuccess({ input, context, result }) {
    const columnChanges = [input.drop, input.update, input.add].some((list) => list?.length)
    if (columnChanges || result.changed.length > 0) signalTableSchemaChanged(context.table.id)
    if (
      result.replaced &&
      (result.replaced.deletedCount > 0 || result.replaced.insertedCount > 0)
    ) {
      signalTableRowsChanged(context.table.id)
    }
  },
})
