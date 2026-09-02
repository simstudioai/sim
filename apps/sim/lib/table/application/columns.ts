import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  addTableColumn,
  type ColumnDefinition,
  type ColumnType,
  deleteColumn,
  deleteColumns,
  getColumnId,
  type SelectOption,
  TABLE_LIMITS,
  type TableDefinition,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { throwTableOperationFailure } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'
import { columnMatchesRef } from '@/lib/table/column-keys'
import {
  findUnmigratedTableBlockReferences,
  type UnmigratedTableBlockReference,
} from '@/lib/table/columns/workflow-references'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'

const logger = createLogger('TableColumnApplication')

interface TableColumnInput {
  tableId: string
  workspaceId: string
}

export interface AddTableColumnInput extends TableColumnInput {
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
  }
}

export const addTableColumnUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.addColumn,
  resolveContext: ({ input }: { input: AddTableColumnInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const table = await addTableColumn(context.table.id, input.column, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
    })
    return { table }
  },
  projectAudit({ input, context, result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Added column "${input.column.name}" to table "${context.table.name}"`,
      metadata: { column: input.column },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.table.id)
  },
})

export interface UpdateTableColumnInput extends TableColumnInput {
  columnName: string
  updates: {
    name?: string
    type?: ColumnType
    required?: boolean
    unique?: boolean
    options?: unknown
    multiple?: boolean
    currencyCode?: string
  }
}

export const updateTableColumnUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateColumn,
  resolveContext: ({ input }: { input: UpdateTableColumnInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const outcome = await performUpdateTableColumn({
      table: context.table,
      columnName: input.columnName,
      userId: attribution.attributedUserId,
      updates: input.updates,
      requestId: generateRequestId(),
      expectedWorkspaceId: context.workspaceId,
      recordAudit: false,
    })
    if (!outcome.success || !outcome.table) {
      throwTableOperationFailure(outcome, 'Failed to update column')
    }
    return {
      table: outcome.table,
      changed:
        JSON.stringify(context.table.schema) !== JSON.stringify(outcome.table.schema) ||
        JSON.stringify(context.table.metadata) !== JSON.stringify(outcome.table.metadata),
      unmigrated: await findUnmigratedReferencesAfterRename(context, input),
    }
  },
  projectAudit({ input, context, result }) {
    if (!result.changed) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Updated column "${input.columnName}" in table "${context.table.name}"`,
      metadata: { columnName: input.columnName, updates: input.updates },
    }
  },
  afterSuccess({ context, result }) {
    if (result.changed) signalTableSchemaChanged(context.table.id)
  },
})

/**
 * Workflow Table blocks the rename left behind. A rename migrates everything
 * keyed by column id — rows, views, workflow-group refs — but a Table block's
 * `filter`/`order`/`data` name columns by name and live in workflow state this
 * operation does not own, so they are reported for the caller to migrate. The
 * rename has already committed by the time this runs; a failed scan is logged
 * and reported as empty rather than failing a mutation that succeeded.
 */
async function findUnmigratedReferencesAfterRename(
  context: { table: TableDefinition; workspaceId: string },
  input: UpdateTableColumnInput
): Promise<UnmigratedTableBlockReference[]> {
  const previous = context.table.schema.columns.find((column) =>
    columnMatchesRef(column, input.columnName)
  )
  const newName = input.updates.name
  if (!previous || newName === undefined || newName === previous.name) return []
  try {
    return await findUnmigratedTableBlockReferences({
      workspaceId: context.workspaceId,
      tableId: context.table.id,
      columnName: previous.name,
    })
  } catch (error) {
    logger.warn('Could not scan workflows for references to a renamed column', {
      tableId: context.table.id,
      columnName: previous.name,
      error: getErrorMessage(error),
    })
    return []
  }
}

export interface DeleteTableColumnInput extends TableColumnInput {
  columnName: string
}

export const deleteTableColumnUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteColumn,
  resolveContext: ({ input }: { input: DeleteTableColumnInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }): Promise<{ table: TableDefinition }> {
    const table = await deleteColumn(
      { tableId: context.table.id, columnName: input.columnName },
      generateRequestId(),
      { expectedWorkspaceId: context.workspaceId }
    )
    return { table }
  },
  projectAudit({ input, context, result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted column "${input.columnName}" from table "${context.table.name}"`,
      metadata: { columnName: input.columnName },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.table.id)
  },
})

export interface DeleteTableColumnsInput extends TableColumnInput {
  columnNames: string[]
}

interface DeletedTableColumn {
  id: string
  name: string
}

export const deleteTableColumnsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteColumn,
  resolveContext: ({ input }: { input: DeleteTableColumnsInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }): Promise<{
    table: TableDefinition
    deletedColumns: DeletedTableColumn[]
  }> {
    if (input.columnNames.length < 1) {
      throw new OrchestrationError('validation', 'At least one column name is required')
    }
    if (input.columnNames.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new OrchestrationError(
        'validation',
        `Cannot delete more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
      )
    }
    const table = await deleteColumns(
      { tableId: context.table.id, columnNames: input.columnNames },
      generateRequestId(),
      { expectedWorkspaceId: context.workspaceId }
    )
    const remainingColumnIds = new Set(table.schema.columns.map(getColumnId))
    const deletedColumns = context.table.schema.columns
      .filter((column) => !remainingColumnIds.has(getColumnId(column)))
      .map((column) => ({ id: getColumnId(column), name: column.name }))
    return { table, deletedColumns }
  },
  projectAudit({ context, result }) {
    if (result.deletedColumns.length === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted ${result.deletedColumns.length} ${result.deletedColumns.length === 1 ? 'column' : 'columns'} from table "${context.table.name}"`,
      metadata: { columnNames: result.deletedColumns.map((column) => column.name) },
    }
  },
  afterSuccess({ context, result }) {
    if (result.deletedColumns.length > 0) signalTableSchemaChanged(context.table.id)
  },
})

export type TableColumnApplicationResult = { table: TableDefinition }
export type TableColumnDefinition = ColumnDefinition
