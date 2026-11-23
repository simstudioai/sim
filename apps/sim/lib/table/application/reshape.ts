import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { userTableDefinitions } from '@sim/db/schema'
import { omit } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
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
import { TableRowsChangedError, throwTableOperationFailure } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'
import {
  type AppliedTableUpdate,
  resolveFolderInput,
  type TableFieldsInput,
  type TableFieldsProgress,
  tableFieldAudits,
  writeTableFields,
} from '@/lib/table/application/tables'
import { assertRowCapacity, getMaxRowsPerTable, notifyTableRowUsage } from '@/lib/table/billing'
import {
  buildIdByName,
  columnMatchesRef,
  getColumnId,
  rowDataNameToId,
} from '@/lib/table/column-keys'
import { columnTypeById } from '@/lib/table/column-types'
import { addTableColumn, deleteColumn, stripDroppedColumnData } from '@/lib/table/columns/service'
import { signalTableRowsChanged, signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { readCurrentRowsVersion } from '@/lib/table/row-changes'
import { writeKeyedRowsWithTx } from '@/lib/table/rows/keyed-write'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { batchInsertRowsWithTx, dispatchAfterBatchInsert } from '@/lib/table/rows/service'
import { withTableWriteTx } from '@/lib/table/service'
import type { TableWriteTx } from '@/lib/table/tx'
import type {
  ColumnDefinition,
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
   * Rows to write once the columns are reshaped, in the same transaction, keyed by column name as
   * the reshape leaves the columns: workspace source's rows. `managed` makes the table's rows equal
   * to `rows`, matched by `keyColumn` and writing only what differs (`writeKeyedRowsWithTx`);
   * `seed` inserts `rows` into a table that holds none, checked under the table's lock (a row
   * written since the caller saw it empty refuses the reshape, `TableRowsChangedError`). A column
   * added `required`, or updated to be, is made required only once the rows are written, so the
   * rows can fill it.
   */
  rows?: ReshapeRows
  /**
   * Marks the rows as managed by workspace source, matched by the column named `keyColumn` as the
   * reshape leaves the columns (`null` clears the mark); absent leaves it alone.
   */
  sourceRows?: { mode: 'managed'; keyColumn: string } | { mode: 'seed' } | null
  /**
   * Records each source column's key, by column name as the reshape leaves the columns
   * (`metadata.sourceColumnKeys`, replaced whole); absent leaves the record alone.
   */
  sourceColumnKeys?: Record<string, string>
  /**
   * The row version the caller read the rows at. Checked under the table's lock before anything
   * changes: a row written since refuses the reshape (`TableRowsChangedError`), so `rows`
   * never overwrites or deletes an edit the caller did not see.
   */
  expectedRowsVersion?: number
}

/** The rows a reshape writes; see {@link ReshapeTableInput.rows}. */
export type ReshapeRows =
  | {
      mode: 'managed'
      keyColumn: string
      rows: RowData[]
      /** The columns the rows declare, by name; other columns' cells are left as stored. */
      columns: string[]
      /** Whether stored rows no declared row matches are deleted (else the reshape refuses). */
      allowDelete: boolean
    }
  | { mode: 'seed'; rows: RowData[] }

/** How many rows a reshape's `rows` inserted, updated and deleted. */
interface RowCounts {
  inserted: number
  updated: number
  deleted: number
}

export interface ReshapeTableResult {
  table: TableDefinition
  /** The table fields that changed. */
  changed: AppliedTableUpdate[]
  /** What the input's `rows` wrote. */
  rows?: RowCounts
}

/** Whether a reshape's row write changed any row. */
function wroteRows(rows: RowCounts | undefined): rows is RowCounts {
  return rows !== undefined && rows.inserted + rows.updated + rows.deleted > 0
}

/** The managed-rows mark of `input`, by the id of its key column; `null` clears it. */
function sourceRowsMark(
  input: NonNullable<ReshapeTableInput['sourceRows']> | null,
  idByName: ReadonlyMap<string, string>
): TableSourceRows | null {
  if (!input) return null
  if (input.mode === 'seed') return input
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

/** Source column keys by column name, as `metadata.sourceColumnKeys` holds them: by column id. */
function sourceColumnKeysById(
  keysByName: Readonly<Record<string, string>>,
  idByName: ReadonlyMap<string, string>
): Record<string, string> {
  const byId: Record<string, string> = {}
  for (const [name, key] of Object.entries(keysByName)) {
    const id = idByName.get(name)
    if (!id) throw new OrchestrationError('validation', `Column "${name}" does not exist`)
    byId[id] = key
  }
  return byId
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
 * renamed, or a capped type no pending update frees, is left to the update to refuse. Each update's
 * column is resolved to its id first, so one addressed by name is still found once another rename
 * took or parked that name.
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
  const pending = updates.map((entry) => {
    const column = table.schema.columns.find((candidate) =>
      columnMatchesRef(candidate, entry.columnName)
    )
    return column ? { ...entry, columnName: getColumnId(column) } : entry
  })
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
 * updates (renames ordered so each finds its name free) and adds, then the managed-rows mark and
 * the rows (`rows`), refused when they changed since `expectedRowsVersion`. Each step is the same
 * service write the single-column and row use cases run, with the same lock checks and
 * validation, joined to one transaction under the table's schema lock: a failure at any step
 * commits nothing. Audits one entry per column change, as the single use cases would, by column
 * name, and one `source_rows` entry for the rows written.
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
    // Read before the transaction opens (it reads the billing pool). Seed rows only add, so they
    // are checked here; a managed write is checked under the lock once it has read the stored rows,
    // so one that adds no rows on balance passes even on a table already over its limit.
    const rowLimit = !input.rows
      ? null
      : input.rows.mode === 'seed'
        ? await assertRowCapacity({
            workspaceId,
            currentRowCount: context.table.rowCount,
            addedRows: input.rows.rows.length,
          })
        : await getMaxRowsPerTable(workspaceId)
    const actor = {
      userId: attributedUserId,
      capabilityGovernedUserId: capabilityGovernedPrincipalUserId(principal),
    }

    /** Writes `rows` in the reshape's transaction; their triggers fire once it commits. */
    async function writeRows(
      tx: TableWriteTx,
      table: TableDefinition,
      rows: ReshapeRows,
      idByName: Map<string, string>
    ): Promise<RowCounts> {
      const stored = rows.rows.map((row) => rowDataNameToId(row, idByName))
      if (rows.mode === 'seed') {
        const inserted = await batchInsertRowsWithTx(
          tx.trx,
          {
            tableId: table.id,
            workspaceId,
            rows: stored,
            userId: actor.userId,
            capabilityGovernedUserId: actor.capabilityGovernedUserId,
            secretProvenance: stored.map(createExactEmptyTableRowSecretProvenance),
          },
          table,
          requestId,
          { uncoercibleValues: 'reject' }
        )
        tx.afterCommit(() =>
          dispatchAfterBatchInsert(
            inserted.table,
            inserted.rows,
            requestId,
            actor.userId,
            actor.capabilityGovernedUserId
          )
        )
        return { inserted: inserted.rows.length, updated: 0, deleted: 0 }
      }
      const keyColumnId = idByName.get(rows.keyColumn)
      if (!keyColumnId) {
        throw new OrchestrationError('validation', `Column "${rows.keyColumn}" does not exist`)
      }
      const written = await writeKeyedRowsWithTx(
        tx.trx,
        table,
        {
          keyColumnId,
          columnIds: rows.columns.flatMap((name) => idByName.get(name) ?? []),
          rows: stored,
          allowDelete: rows.allowDelete,
          ...(rowLimit !== null ? { rowLimit } : {}),
        },
        actor,
        requestId
      )
      tx.afterCommit(written.dispatch)
      return { inserted: written.inserted, updated: written.updated, deleted: written.deleted }
    }

    const result = await withTableWriteTx(
      context.table.id,
      async (locked, tx) => {
        // Row writes hold the schema lock shared until they commit, so under it the version is final.
        if (
          input.expectedRowsVersion !== undefined &&
          (await readCurrentRowsVersion(locked.id, workspaceId, tx.trx)) !==
            input.expectedRowsVersion
        ) {
          throw new TableRowsChangedError(locked.name)
        }
        if (input.rows?.mode === 'seed' && locked.rowCount > 0) {
          throw new TableRowsChangedError(locked.name)
        }
        const options = { expectedWorkspaceId: workspaceId, tx }
        const progress: TableFieldsProgress = { current: locked, applied: [], changed: [] }
        if (input.table) await writeTableFields(progress, input.table, resolution?.folderId, tx)
        let table = progress.current
        // Managed rows' version is the base source compares with, so the drop's cell strip
        // commits with it rather than moving the version after the apply recorded it.
        const managed =
          input.sourceRows === undefined
            ? locked.metadata?.sourceRows?.mode === 'managed'
            : input.sourceRows?.mode === 'managed'
        const droppedIds: string[] = []
        for (const columnName of input.drop ?? []) {
          const dropped = table.schema.columns.find((column) =>
            columnMatchesRef(column, columnName)
          )
          table = await deleteColumn({ tableId: table.id, columnName }, requestId, {
            ...options,
            callerStripsRows: managed,
          })
          if (managed && dropped) droppedIds.push(getColumnId(dropped))
        }
        await stripDroppedColumnData(tx, table, droppedIds)
        // With rows to write, a column made required is made so after them (an add, below, too).
        const deferredUpdates: string[] = []
        const updates = (input.update ?? []).flatMap((entry) => {
          const column = table.schema.columns.find((candidate) =>
            columnMatchesRef(candidate, entry.columnName)
          )
          if (!input.rows || entry.updates.required !== true || !column) return [entry]
          deferredUpdates.push(getColumnId(column))
          const rest = omit(entry.updates, ['required'])
          return Object.keys(rest).length > 0 ? [{ ...entry, updates: rest }] : []
        })
        table = await updateColumns(table, updates, async (current, columnName, updates) => {
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
        })
        const deferredAdds = input.rows ? (input.add ?? []).filter((column) => column.required) : []
        for (const column of input.add ?? []) {
          const optional = deferredAdds.includes(column) ? { ...column, required: false } : column
          table = await addTableColumn(table.id, optional, requestId, {
            ...options,
            refuseEmptyRequired: true,
          })
        }
        const idByName = buildIdByName(table.schema)
        if (input.sourceRows !== undefined || input.sourceColumnKeys !== undefined) {
          let metadata: TableMetadata = table.metadata ?? {}
          if (input.sourceRows !== undefined) {
            metadata = withSourceRows(metadata, sourceRowsMark(input.sourceRows, idByName))
          }
          if (input.sourceColumnKeys !== undefined) {
            metadata = {
              ...metadata,
              sourceColumnKeys: sourceColumnKeysById(input.sourceColumnKeys, idByName),
            }
          }
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
        const rows = input.rows ? await writeRows(tx, table, input.rows, idByName) : undefined
        for (const columnName of [...deferredUpdates, ...deferredAdds.map(({ name }) => name)]) {
          const outcome = await performUpdateTableColumn({
            table,
            columnName,
            userId: attributedUserId,
            updates: { required: true },
            requestId,
            expectedWorkspaceId: workspaceId,
            tx,
            recordAudit: false,
          })
          if (!outcome.success || !outcome.table) {
            throwTableOperationFailure(outcome, 'Failed to make the column required')
          }
          table = outcome.table
        }
        return { table, changed: progress.changed, ...(rows ? { rows } : {}) }
      },
      { expectedWorkspaceId: workspaceId }
    )
    if (rowLimit !== null && result.rows && result.rows.inserted > 0) {
      notifyTableRowUsage({
        workspaceId,
        currentRowCount: context.table.rowCount,
        addedRows: result.rows.inserted,
        limit: rowLimit,
      })
    }
    return result
  },
  projectAudit({ input, context, result }) {
    const before = context.table
    // The audit names a column, never its id, as the single-column use cases do.
    const nameOf = (ref: string) =>
      before.schema.columns.find((column) => columnMatchesRef(column, ref))?.name ?? ref
    return [
      ...tableFieldAudits(before, input.table ?? {}, result.changed, result.table.name),
      ...(input.drop ?? []).map((columnName) =>
        columnDeletedAudit(before, result.table, nameOf(columnName))
      ),
      ...(input.update ?? []).map(({ columnName, updates }) =>
        columnUpdatedAudit(before, result.table, nameOf(columnName), updates)
      ),
      ...(input.add ?? []).map((column) => columnAddedAudit(before, result.table, column)),
      ...(wroteRows(result.rows)
        ? [
            {
              action: AuditAction.TABLE_UPDATED,
              resourceType: AuditResourceType.TABLE,
              resourceId: result.table.id,
              resourceName: result.table.name,
              description: `Wrote source rows in table "${result.table.name}"`,
              metadata: {
                op: 'source_rows',
                rowsInserted: result.rows.inserted,
                rowsUpdated: result.rows.updated,
                rowsDeleted: result.rows.deleted,
              },
            },
          ]
        : []),
    ]
  },
  afterSuccess({ input, context, result }) {
    const columnChanges = [input.drop, input.update, input.add].some((list) => list?.length)
    if (columnChanges || result.changed.length > 0) signalTableSchemaChanged(context.table.id)
    if (wroteRows(result.rows)) signalTableRowsChanged(context.table.id)
  },
})
