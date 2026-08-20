import { TableManage } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

type TableManageArgs = {
  operation: string
  args?: Record<string, any>
}

type TableManageResult = {
  success: boolean
  message: string
  data?: any
}

const ALLOWED_OPERATIONS = new Set(['create', 'create_from_file', 'import_file', 'rename'])

/**
 * table lifecycle (create, create_from_file, import_file, rename) slice of the split user_table surface. Copilot access control is a
 * per-agent tool allowlist, so each slice gets its own tool name with its own
 * operation contract — enforced here (where execution happens) on top of the
 * schema enum in the Go catalog. Delegates to the shared user_table executor,
 * so argument semantics stay identical by construction.
 */
export const tableManageServerTool: BaseServerTool<TableManageArgs, TableManageResult> = {
  name: TableManage.id,
  async execute(params: TableManageArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!ALLOWED_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `table_manage does not support operation '${operation}' (allowed: create, create_from_file, import_file, rename); other table operations live on their own table_* tools`,
      }
    }
    return userTableServerTool.execute(params, context)
  },
}
