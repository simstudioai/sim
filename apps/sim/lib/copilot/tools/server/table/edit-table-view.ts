import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { EditTableView } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  hasViewConfigParts,
  presentTableView,
  type TableViewToolConfig,
  type TableViewToolResult,
  viewToolConfigToPatch,
} from '@/lib/copilot/tools/server/table/view-tool-shared'
import type { TableSchema } from '@/lib/table'
import { readTableViewByIdUseCase, updateTableViewUseCase } from '@/lib/table/application/views'

interface EditTableViewArgs {
  viewId?: string
  name?: string
  config?: TableViewToolConfig
  isDefault?: boolean
}

/**
 * The main agent's direct path to changing a saved view by view id alone. The
 * id-addressed read resolves (and authorizes against) the owning table, which
 * also supplies the columns the config patch is translated with; the update
 * then runs as the ordinary table-scoped mutation. Config parts are
 * replace-or-keep, so a filter change never clears the saved sort.
 */
export const editTableViewServerTool: BaseServerTool<EditTableViewArgs, TableViewToolResult> = {
  name: EditTableView.id,
  async execute(params, context) {
    const viewId = params?.viewId?.trim()
    const workspaceId = context?.workspaceId
    if (!viewId) return { success: false, message: 'viewId is required' }
    if (!workspaceId) return { success: false, message: 'Workspace ID is required' }

    const name = typeof params.name === 'string' ? params.name : undefined
    const config =
      params.config !== undefined && hasViewConfigParts(params.config) ? params.config : undefined
    if (name === undefined && config === undefined && params.isDefault === undefined) {
      return {
        success: false,
        message:
          'Nothing to change — pass name, config (filter, sort, hiddenColumns), and/or isDefault',
      }
    }

    const resolved = await executeCopilotTableUseCase(context, readTableViewByIdUseCase, {
      viewId,
      workspaceId,
    })
    const tableId = resolved.table.id
    const columns = (resolved.table.schema as TableSchema).columns
    const updated = await executeCopilotTableUseCase(
      context,
      updateTableViewUseCase,
      {
        tableId,
        workspaceId,
        viewId,
        name,
        ...(config ? { configPatch: viewToolConfigToPatch(config, columns) } : {}),
        isDefault: params.isDefault,
      },
      { tableId }
    )
    const view = presentTableView(updated.view, columns)
    return {
      success: true,
      message: `Updated view "${view.name}" on table "${updated.table.name}"`,
      data: { viewId: view.id, tableId, tableName: updated.table.name, view },
    }
  },
}
