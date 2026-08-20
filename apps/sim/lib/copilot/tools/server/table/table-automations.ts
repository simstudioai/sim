import { TableAutomations } from '@/lib/copilot/generated/tool-catalog-v1'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'

type TableAutomationsArgs = {
  operation: string
  args?: Record<string, any>
}

type TableAutomationsResult = {
  success: boolean
  message: string
  data?: any
}

const ALLOWED_OPERATIONS = new Set([
  'list_workflow_outputs',
  'add_workflow_group',
  'update_workflow_group',
  'delete_workflow_group',
  'add_workflow_group_output',
  'delete_workflow_group_output',
  'run_column',
  'cancel_table_runs',
])

/**
 * per-row workflow automations slice of the split user_table surface. Copilot access control is a
 * per-agent tool allowlist, so each slice gets its own tool name with its own
 * operation contract — enforced here (where execution happens) on top of the
 * schema enum in the Go catalog. Delegates to the shared user_table executor,
 * so argument semantics stay identical by construction.
 */
export const tableAutomationsServerTool: BaseServerTool<
  TableAutomationsArgs,
  TableAutomationsResult
> = {
  name: TableAutomations.id,
  async execute(params: TableAutomationsArgs, context?: ServerToolContext) {
    const operation = params?.operation
    if (!ALLOWED_OPERATIONS.has(operation)) {
      return {
        success: false,
        message: `table_automations does not support operation '${operation}' (allowed: list_workflow_outputs, add_workflow_group, update_workflow_group, delete_workflow_group, add_workflow_group_output, delete_workflow_group_output, run_column, cancel_table_runs); other table operations live on their own table_* tools`,
      }
    }
    return userTableServerTool.execute(params, context)
  },
}
