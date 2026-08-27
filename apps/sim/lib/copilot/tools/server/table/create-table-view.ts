import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { CreateTableView } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  presentTableView,
  type TableViewToolConfig,
  type TableViewToolResult,
  viewToolConfigToPatch,
} from '@/lib/copilot/tools/server/table/view-tool-shared'
import type { TableSchema } from '@/lib/table'
import { createTableViewUseCase, listTableViewsUseCase } from '@/lib/table/application/views'

interface CreateTableViewArgs {
  tableId?: string
  name?: string
  config?: TableViewToolConfig
  isDefault?: boolean
}

/**
 * The main agent's direct path to a new saved view (the table subagent goes
 * through table_views). One list read supplies the columns for name→id
 * translation; the create then lands in a single locked transaction — default
 * flag and, when no name was given, the `View N` fallback included, so two
 * unnamed creates can never pick the same N. The result names the table so
 * resource extraction opens the panel pinned to the new view.
 */
export const createTableViewServerTool: BaseServerTool<CreateTableViewArgs, TableViewToolResult> = {
  name: CreateTableView.id,
  async execute(params, context) {
    const tableId = params?.tableId?.trim()
    const workspaceId = context?.workspaceId
    if (!tableId) return { success: false, message: 'tableId is required' }
    if (!workspaceId) return { success: false, message: 'Workspace ID is required' }

    const listed = await executeCopilotTableUseCase(
      context,
      listTableViewsUseCase,
      { tableId, workspaceId },
      { tableId }
    )
    const columns = (listed.table.schema as TableSchema).columns
    const name = params.name?.trim() || undefined
    const created = await executeCopilotTableUseCase(
      context,
      createTableViewUseCase,
      {
        tableId,
        workspaceId,
        name,
        config: viewToolConfigToPatch(params.config ?? {}, columns),
        isDefault: params.isDefault,
      },
      { tableId }
    )
    const view = presentTableView(created.view, columns)
    return {
      success: true,
      message: `Created view "${view.name}" (${view.id}) on table "${created.table.name}"${view.isDefault ? ' as its default' : ''}`,
      data: { viewId: view.id, tableId: created.table.id, tableName: created.table.name, view },
    }
  },
}
