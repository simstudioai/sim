import { QueryUserTable } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

type QueryUserTableArgs = {
  operation: string
  args?: Record<string, any>
}

type QueryUserTableResult = {
  success: boolean
  message: string
  data?: any
}

const READ_OPERATIONS = new Set(['get', 'get_schema', 'get_row', 'query_rows'])

/**
 * Read-only variant of user_table for info-gathering agents. Copilot access
 * control is a per-agent tool allowlist, so read-only access gets its own tool
 * name with its own operation contract — enforced here (where execution
 * happens) on top of the fail-fast guard in the Go executor. outputPath is
 * rejected because query_rows exports rows to a workspace file through it.
 */
export const queryUserTableServerTool: BaseServerTool<QueryUserTableArgs, QueryUserTableResult> = {
  name: QueryUserTable.id,
  async execute(params: QueryUserTableArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!READ_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `query_user_table is read-only: operation '${operation}' is not available (allowed: get, get_row, get_schema, query_rows); mutations go through the table agent's user_table tool`,
      }
    }
    if (params?.args && 'outputPath' in params.args) {
      return {
        success: false,
        message:
          'query_user_table is read-only: outputPath (file export) is not available; digest the rows directly or route exports through the table agent',
      }
    }
    if (params && 'outputPath' in (params as Record<string, unknown>)) {
      return {
        success: false,
        message:
          'query_user_table is read-only: outputPath (file export) is not available; digest the rows directly or route exports through the table agent',
      }
    }
    return userTableServerTool.execute(params, context)
  },
}
