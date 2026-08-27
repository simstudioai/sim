import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { TableViews } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SortSpec, TablePredicateInput, TableSchema, TableViewConfig } from '@/lib/table'
import {
  createTableViewUseCase,
  deleteTableViewUseCase,
  listTableViewsUseCase,
  readTableViewUseCase,
  updateTableViewUseCase,
} from '@/lib/table/application/views'
import {
  TableViewValidationError,
  viewConfigIdsToNames,
  viewConfigNamesToIds,
} from '@/lib/table/views/service'

type TableViewsArgs = {
  operation: string
  args?: Record<string, any>
}

type TableViewsResult = {
  success: boolean
  message: string
  data?: any
}

type StoredView = { id: string; name: string; isDefault: boolean; config: TableViewConfig }

/**
 * Saved-view slice of the split table surface. Unlike the other slices this is
 * NOT a user_table passthrough — it adapts the dedicated view use cases.
 * Agents speak column NAMES; stored configs are keyed by stable column id, so
 * inputs translate names→ids on the way in and every returned view translates
 * ids→names on the way out. Every write also names the table and the view it
 * touched in `data`; resource extraction reads that to open the panel on the
 * view that was just written.
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

    const presentView = (view: StoredView, columns: TableSchema['columns']) => {
      const named = viewConfigIdsToNames(view.config, columns)
      return {
        id: view.id,
        name: view.name,
        isDefault: view.isDefault,
        filter: named.filter ?? null,
        sort: named.sort ?? null,
        hiddenColumns: named.hiddenColumns?.length ? named.hiddenColumns : undefined,
      }
    }

    // What a write hands back: the view, plus the ids the resource panel opens on.
    const presentWrite = (
      table: { id: string; name: string },
      view: StoredView,
      columns: TableSchema['columns']
    ) => ({
      tableId: table.id,
      tableName: table.name,
      viewId: view.id,
      view: presentView(view, columns),
    })

    // Build the patch from only the keys the caller actually sent: the update
    // path shallow-merges this into the stored config, so including an absent
    // part as `null` silently wiped a view's saved sort when only the filter
    // changed (and vice versa) — the doc promises "omit to keep, null to clear".
    // The name→id translation runs here, outside the use case that would
    // classify a bad column name, so it is classified here: unclassified, the
    // model gets a masked "system error" instead of the column it got wrong.
    const namedConfigFromArgs = (columns: TableSchema['columns']): TableViewConfig => {
      const patch: Record<string, unknown> = {}
      if (args.filter !== undefined) patch.filter = args.filter as TablePredicateInput | null
      if (args.sort !== undefined) patch.sort = args.sort as SortSpec | null
      if (args.hiddenColumns !== undefined) patch.hiddenColumns = args.hiddenColumns as string[]
      try {
        return viewConfigNamesToIds(patch as TableViewConfig, columns)
      } catch (error) {
        if (error instanceof TableViewValidationError) {
          throw new OrchestrationError('validation', error.message)
        }
        throw error
      }
    }

    switch (operation) {
      case 'list_views': {
        const result = await executeCopilotTableUseCase(
          context,
          listTableViewsUseCase,
          { tableId, workspaceId },
          { tableId }
        )
        const columns = (result.table.schema as TableSchema).columns
        const views = result.views.map((view) => presentView(view, columns))
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
          data: { view: presentView(result.view, columns) },
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
        // The default flag lands in the same locked transaction as the insert
        // (demoting the previous default), so no follow-up write can race it.
        const created = await executeCopilotTableUseCase(
          context,
          createTableViewUseCase,
          {
            tableId,
            workspaceId,
            name: args.name,
            config: namedConfigFromArgs(columns),
            ...(args.isDefault === true ? { isDefault: true } : {}),
          },
          { tableId }
        )
        return {
          success: true,
          message: `Created view "${created.view.name}" (${created.view.id})${created.view.isDefault ? ' as default' : ''}`,
          data: presentWrite(created.table, created.view, columns),
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
          data: presentWrite(updated.table, updated.view, columns),
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
        return {
          success: true,
          message: `Deleted view "${result.viewName}"`,
          data: { tableId: result.table.id, tableName: result.table.name },
        }
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
          data: presentWrite(updated.table, updated.view, columns),
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
