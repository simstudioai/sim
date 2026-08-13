import { TableRows } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

type TableRowsArgs = {
  operation: string
  args?: Record<string, any>
}

type TableRowsResult = {
  success: boolean
  message: string
  data?: any
}

const ALLOWED_OPERATIONS = new Set([
  'insert_row',
  'batch_insert_rows',
  'update_row',
  'batch_update_rows',
  'delete_row',
  'batch_delete_rows',
  'update_rows_by_filter',
  'delete_rows_by_filter',
])

/**
 * row data (insert/update/delete, batch and by-filter) slice of the split user_table surface. Copilot access control is a
 * per-agent tool allowlist, so each slice gets its own tool name with its own
 * operation contract — enforced here (where execution happens) on top of the
 * schema enum in the Go catalog. Delegates to the shared user_table executor,
 * so argument semantics stay identical by construction.
 */
export const tableRowsServerTool: BaseServerTool<TableRowsArgs, TableRowsResult> = {
  name: TableRows.id,
  async execute(params: TableRowsArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!ALLOWED_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `table_rows does not support operation '${operation}' (allowed: insert_row, batch_insert_rows, update_row, batch_update_rows, delete_row, batch_delete_rows, update_rows_by_filter, delete_rows_by_filter); other table operations live on their own table_* tools`,
      }
    }
    return userTableServerTool.execute(params, context)
  },
}
