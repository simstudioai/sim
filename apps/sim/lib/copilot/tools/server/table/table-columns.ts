import { TableColumns } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

type TableColumnsArgs = {
  operation: string
  args?: Record<string, any>
}

type TableColumnsResult = {
  success: boolean
  message: string
  data?: any
}

const ALLOWED_OPERATIONS = new Set([
  'add_column',
  'rename_column',
  'delete_column',
  'update_column',
])

/**
 * column DDL (add/rename/retype/delete) slice of the split user_table surface. Copilot access control is a
 * per-agent tool allowlist, so each slice gets its own tool name with its own
 * operation contract — enforced here (where execution happens) on top of the
 * schema enum in the Go catalog. Delegates to the shared user_table executor,
 * so argument semantics stay identical by construction.
 */
export const tableColumnsServerTool: BaseServerTool<TableColumnsArgs, TableColumnsResult> = {
  name: TableColumns.id,
  async execute(params: TableColumnsArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!ALLOWED_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `table_columns does not support operation '${operation}' (allowed: add_column, rename_column, delete_column, update_column); other table operations live on their own table_* tools`,
      }
    }
    return userTableServerTool.execute(params, context)
  },
}
