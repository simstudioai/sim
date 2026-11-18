import { resolvePrincipalAttribution } from '@sim/auth/principal'
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
import { columnMatchesRef } from '@/lib/table/column-keys'
import { columnTypeById } from '@/lib/table/column-types'
import { addTableColumn, deleteColumn } from '@/lib/table/columns/service'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'
import { withTableWriteTx } from '@/lib/table/service'
import type { ColumnDefinition, TableDefinition } from '@/lib/table/types'

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
}

export interface ReshapeTableResult {
  table: TableDefinition
  /** The table fields that changed. */
  changed: AppliedTableUpdate[]
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
    return withTableWriteTx(
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
        return { table, changed: progress.changed }
      },
      { expectedWorkspaceId: workspaceId }
    )
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
    ]
  },
  afterSuccess({ input, context, result }) {
    const columnChanges = [input.drop, input.update, input.add].some((list) => list?.length)
    if (columnChanges || result.changed.length > 0) signalTableSchemaChanged(context.table.id)
  },
})
