import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  addTableColumn,
  type ColumnDefinition,
  type ColumnType,
  deleteColumn,
  deleteColumns,
  type SelectOption,
  type TableDefinition,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { throwTableOperationFailure } from '@/lib/table/application/errors'
import { tableOperations } from '@/lib/table/application/operations'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { performUpdateTableColumn } from '@/lib/table/orchestration'

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

export const deleteTableColumnsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteColumn,
  resolveContext: ({ input }: { input: DeleteTableColumnsInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }): Promise<{ table: TableDefinition }> {
    if (input.columnNames.length < 1) {
      throw new Error('At least one column name is required')
    }
    const table = await deleteColumns(
      { tableId: context.table.id, columnNames: input.columnNames },
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
      description: `Deleted ${input.columnNames.length} columns from table "${context.table.name}"`,
      metadata: { columnNames: input.columnNames },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.table.id)
  },
})

export type TableColumnApplicationResult = { table: TableDefinition }
export type TableColumnDefinition = ColumnDefinition
