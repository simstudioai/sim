import { createLogger } from '@sim/logger'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { workspaceFileServerTool } from '@/lib/copilot/tools/server/files/workspace-file'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getExecutionSummaryServerTool } from '@/lib/copilot/tools/server/workflow/get-execution-summary'
import { getWorkflowLogsServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-logs'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

const logger = createLogger('ServerToolRouter')

const WRITE_ACTIONS: Record<string, string[]> = {
  knowledge_base: ['create', 'add_document', 'delete'],
  user_table: ['create', 'insert', 'update', 'delete', 'delete_table'],
  manage_custom_tool: ['add', 'edit', 'delete'],
  manage_mcp_tool: ['add', 'edit', 'delete'],
  manage_skill: ['add', 'edit', 'delete'],
}

function isActionAllowed(toolName: string, action: string, userPermission: string): boolean {
  const writeActions = WRITE_ACTIONS[toolName]
  if (!writeActions || !writeActions.includes(action)) return true
  return userPermission === 'write' || userPermission === 'admin'
}

/** Registry of all server tools. Tools self-declare their validation schemas. */
const serverToolRegistry: Record<string, BaseServerTool> = {
  [getBlocksMetadataServerTool.name]: getBlocksMetadataServerTool,
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [getExecutionSummaryServerTool.name]: getExecutionSummaryServerTool,
  [getWorkflowLogsServerTool.name]: getWorkflowLogsServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [makeApiRequestServerTool.name]: makeApiRequestServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [userTableServerTool.name]: userTableServerTool,
  [workspaceFileServerTool.name]: workspaceFileServerTool,
}

/**
 * Route a tool execution request to the appropriate server tool.
 * Validates input/output using the tool's declared Zod schemas if present.
 */
export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolContext
): Promise<unknown> {
  const tool = serverToolRegistry[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug('Routing to tool', { toolName })

  // Action-level permission enforcement for mixed read/write tools
  if (context?.userPermission && WRITE_ACTIONS[toolName]) {
    const action = (payload as Record<string, unknown>)?.action as string
    if (action && !isActionAllowed(toolName, action, context.userPermission)) {
      throw new Error(
        `Permission denied: '${action}' on ${toolName} requires write access. You have '${context.userPermission}' permission.`
      )
    }
  }

  // Validate input if tool declares a schema
  const args = tool.inputSchema ? tool.inputSchema.parse(payload ?? {}) : (payload ?? {})

  // Execute
  const result = await tool.execute(args, context)

  // Validate output if tool declares a schema
  return tool.outputSchema ? tool.outputSchema.parse(result) : result
}
