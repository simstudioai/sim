import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  addTableColumn,
  type ColumnType,
  deleteColumn,
  type SelectOption,
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

/** The audit entry of a column added to `before`, which became `after`. */
export function columnAddedAudit(
  before: TableDefinition,
  after: TableDefinition,
  column: AddTableColumnInput['column']
) {
  return {
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: after.id,
    resourceName: after.name,
    description: `Added column "${column.name}" to table "${before.name}"`,
    metadata: { column },
  }
}

/** The audit entry of a column update on `before`, which became `after`. */
export function columnUpdatedAudit(
  before: TableDefinition,
  after: TableDefinition,
  columnName: string,
  updates: UpdateTableColumnInput['updates']
) {
  return {
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: after.id,
    resourceName: after.name,
    description: `Updated column "${columnName}" in table "${before.name}"`,
    metadata: { columnName, updates },
  }
}

/** The audit entry of a column deleted from `before`, which became `after`. */
export function columnDeletedAudit(
  before: TableDefinition,
  after: TableDefinition,
  columnName: string
) {
  return {
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: after.id,
    resourceName: after.name,
    description: `Deleted column "${columnName}" from table "${before.name}"`,
    metadata: { columnName },
  }
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
    return columnAddedAudit(context.table, result.table, input.column)
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
    return columnUpdatedAudit(context.table, result.table, input.columnName, input.updates)
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
    return columnDeletedAudit(context.table, result.table, input.columnName)
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.table.id)
  },
})
