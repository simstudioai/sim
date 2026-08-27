import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { TableViews } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import {
  presentTableView,
  type TableViewToolConfig,
  viewToolConfigToPatch,
} from '@/lib/copilot/tools/server/table/view-tool-shared'
import type { TableSchema, TableViewConfig } from '@/lib/table'
import {
  createTableViewUseCase,
  deleteTableViewUseCase,
  listTableViewsUseCase,
  readTableViewUseCase,
  updateTableViewUseCase,
} from '@/lib/table/application/views'

type TableViewsArgs = {
  operation: string
  args?: Record<string, any>
}

type TableViewsResult = {
  success: boolean
  message: string
  data?: any
}

/**
 * Saved-view slice of the split table surface. Unlike the other slices this is
 * NOT a user_table passthrough — it adapts the dedicated view use cases.
 * Agents speak column NAMES; stored configs are keyed by stable column id, so
 * inputs translate names→ids on the way in and every returned view translates
 * ids→names on the way out.
 */
export const tableViewsServerTool: BaseServerTool<TableViewsArgs, TableViewsResult> = {
  name: TableViews.id,
  async execute(params: TableViewsArgs, context?: ServerToolContext) {
    const operation = params?.operation
    const args = params?.args ?? {}
    const tableId = args.tableId as string | undefined
    const workspaceId = context?.workspaceId
    if (!tableId) return { success: false, message: 'Table ID is required' }
    if (!workspaceId) return { success: false, message: 'Workspace ID is required' }

    const namedConfigFromArgs = (columns: TableSchema['columns']): TableViewConfig =>
      viewToolConfigToPatch(args as TableViewToolConfig, columns)

    switch (operation) {
      case 'list_views': {
        const result = await executeCopilotTableUseCase(
          context,
          listTableViewsUseCase,
          { tableId, workspaceId },
          { tableId }
        )
        const columns = (result.table.schema as TableSchema).columns
        const views = result.views.map((view) => presentTableView(view, columns))
        return {
          success: true,
          message: `Table has ${views.length} view(s)`,
          data: { views },
        }
      }
      case 'get_view': {
        if (!args.viewId) return { success: false, message: 'viewId is required' }
        const result = await executeCopilotTableUseCase(
          context,
          readTableViewUseCase,
          { tableId, workspaceId, viewId: args.viewId },
          { tableId }
        )
        const columns = (result.table.schema as TableSchema).columns
        return {
          success: true,
          message: 'View loaded',
          data: { view: presentTableView(result.view, columns) },
        }
      }
      case 'create_view': {
        if (!args.name) return { success: false, message: 'name is required' }
        const listed = await executeCopilotTableUseCase(
          context,
          listTableViewsUseCase,
          { tableId, workspaceId },
          { tableId }
        )
        const columns = (listed.table.schema as TableSchema).columns
        const created = await executeCopilotTableUseCase(
          context,
          createTableViewUseCase,
          { tableId, workspaceId, name: args.name, config: namedConfigFromArgs(columns) },
          { tableId }
        )
        if (args.isDefault === true) {
          await executeCopilotTableUseCase(
            context,
            updateTableViewUseCase,
            { tableId, workspaceId, viewId: created.view.id, isDefault: true },
            { tableId }
          )
        }
        return {
          success: true,
          message: `Created view "${created.view.name}" (${created.view.id})${args.isDefault === true ? ' as default' : ''}`,
          data: {
            view: presentTableView(
              { ...created.view, isDefault: args.isDefault === true },
              columns
            ),
          },
        }
      }
      case 'update_view': {
        if (!args.viewId) return { success: false, message: 'viewId is required' }
        const listed = await executeCopilotTableUseCase(
          context,
          listTableViewsUseCase,
          { tableId, workspaceId },
          { tableId }
        )
        const columns = (listed.table.schema as TableSchema).columns
        const hasConfigChange =
          args.filter !== undefined || args.sort !== undefined || args.hiddenColumns !== undefined
        const updated = await executeCopilotTableUseCase(
          context,
          updateTableViewUseCase,
          {
            tableId,
            workspaceId,
            viewId: args.viewId,
            name: args.name as string | undefined,
            ...(hasConfigChange ? { configPatch: namedConfigFromArgs(columns) } : {}),
            isDefault: args.isDefault as boolean | undefined,
          },
          { tableId }
        )
        return {
          success: true,
          message: `Updated view "${updated.view.name}"`,
          data: { view: presentTableView(updated.view, columns) },
        }
      }
      case 'delete_view': {
        if (!args.viewId) return { success: false, message: 'viewId is required' }
        const result = await executeCopilotTableUseCase(
          context,
          deleteTableViewUseCase,
          { tableId, workspaceId, viewId: args.viewId },
          { tableId }
        )
        return { success: true, message: `Deleted view "${result.viewName}"` }
      }
      case 'set_default_view': {
        if (!args.viewId) return { success: false, message: 'viewId is required' }
        const listed = await executeCopilotTableUseCase(
          context,
          listTableViewsUseCase,
          { tableId, workspaceId },
          { tableId }
        )
        const columns = (listed.table.schema as TableSchema).columns
        const updated = await executeCopilotTableUseCase(
          context,
          updateTableViewUseCase,
          { tableId, workspaceId, viewId: args.viewId, isDefault: true },
          { tableId }
        )
        return {
          success: true,
          message: `"${updated.view.name}" is now the default view`,
          data: { view: presentTableView(updated.view, columns) },
        }
      }
      default:
        return {
          success: false,
          message: `table_views does not support operation '${operation}' (allowed: list_views, get_view, create_view, update_view, delete_view, set_default_view)`,
        }
    }
  },
}
