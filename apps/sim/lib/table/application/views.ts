import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { TableSchema, TableViewConfig } from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import {
  createTableView,
  deleteTableView,
  getTableView,
  listTableViews,
  TableViewValidationError,
  updateTableView,
} from '@/lib/table/views/service'

interface TableViewInput {
  tableId: string
  workspaceId: string
}

interface TableViewResourceInput extends TableViewInput {
  viewId: string
}

function rethrowViewError(error: unknown): never {
  if (error instanceof TableViewValidationError) {
    throw new OrchestrationError('validation', error.message)
  }
  throw error
}

export const listTableViewsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.listViews,
  resolveContext: ({ input }: { input: TableViewInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    const columns = (context.table.schema as TableSchema).columns
    const views = await listTableViews(context.table.id, columns, context.workspaceId)
    // Both result shapes are live: staging consumers read `columns`, the
    // copilot table tools read `table`.
    return { views, columns, table: context.table }
  },
})

export const readTableViewUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.readView,
  resolveContext: ({ input }: { input: TableViewResourceInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const columns = (context.table.schema as TableSchema).columns
    const view = await getTableView(input.viewId, context.table.id, columns, context.workspaceId)
    if (!view)
      throw new OrchestrationError(
        'not_found',
        'View not found on this table — call table_views with operation "list_views" for valid view ids'
      )
    return { view, columns, table: context.table }
  },
})

export interface CreateTableViewInput extends TableViewInput {
  name: string
  config: TableViewConfig
}

export const createTableViewUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createView,
  resolveContext: ({ input }: { input: CreateTableViewInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const columns = (context.table.schema as TableSchema).columns
    try {
      const view = await createTableView({
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        name: input.name,
        config: input.config,
        userId: attribution.attributedUserId,
        columns,
        strictRefs: true,
      })
      return { view, table: context.table, columns }
    } catch (error) {
      rethrowViewError(error)
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Created view "${result.view.name}" on table "${result.table.name}"`,
      metadata: { op: 'create_view', viewId: result.view.id },
    }
  },
})

export interface UpdateTableViewInput extends TableViewResourceInput {
  name?: string
  config?: TableViewConfig
  configPatch?: TableViewConfig
  isDefault?: boolean
}

export const updateTableViewUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateView,
  resolveContext: ({ input }: { input: UpdateTableViewInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const columns = (context.table.schema as TableSchema).columns
    try {
      const existing = await getTableView(
        input.viewId,
        context.table.id,
        columns,
        context.workspaceId
      )
      if (!existing)
        throw new OrchestrationError(
          'not_found',
          'View not found on this table — call table_views with operation "list_views" for valid view ids'
        )
      const view = await updateTableView({
        viewId: input.viewId,
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        name: input.name,
        config: input.config,
        configPatch: input.configPatch,
        isDefault: input.isDefault,
        columns,
        strictRefs: true,
      })
      if (!view)
        throw new OrchestrationError(
          'not_found',
          'View not found on this table — call table_views with operation "list_views" for valid view ids'
        )
      return {
        view,
        table: context.table,
        columns,
        changed:
          existing.name !== view.name ||
          existing.isDefault !== view.isDefault ||
          JSON.stringify(existing.config) !== JSON.stringify(view.config),
      }
    } catch (error) {
      rethrowViewError(error)
    }
  },
  projectAudit({ result }) {
    if (!result.changed) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Updated view "${result.view.name}" on table "${result.table.name}"`,
      metadata: { op: 'update_view', viewId: result.view.id },
    }
  },
})

export const deleteTableViewUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteView,
  resolveContext: ({ input }: { input: TableViewResourceInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const existing = await getTableView(
      input.viewId,
      context.table.id,
      (context.table.schema as TableSchema).columns,
      context.workspaceId
    )
    if (!existing)
      throw new OrchestrationError(
        'not_found',
        'View not found on this table — call table_views with operation "list_views" for valid view ids'
      )
    try {
      const deleted = await deleteTableView(input.viewId, context.table.id, context.workspaceId)
      if (!deleted)
        throw new OrchestrationError(
          'not_found',
          'View not found on this table — call table_views with operation "list_views" for valid view ids'
        )
      return { viewId: input.viewId, viewName: existing.name, table: context.table }
    } catch (error) {
      rethrowViewError(error)
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted view "${result.viewName}" from table "${result.table.name}"`,
      metadata: { op: 'delete_view', viewId: result.viewId },
    }
  },
})
