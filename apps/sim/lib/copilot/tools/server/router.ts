import { createLogger } from '@sim/logger'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { downloadToWorkspaceFileServerTool } from '@/lib/copilot/tools/server/files/download-to-workspace-file'
import { workspaceFileServerTool } from '@/lib/copilot/tools/server/files/workspace-file'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'
import { getJobLogsServerTool } from '@/lib/copilot/tools/server/jobs/get-job-logs'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { generateVisualizationServerTool } from '@/lib/copilot/tools/server/visualization/generate-visualization'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getExecutionSummaryServerTool } from '@/lib/copilot/tools/server/workflow/get-execution-summary'
import { getWorkflowLogsServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-logs'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

const logger = createLogger('ServerToolRouter')

const WRITE_ACTIONS: Record<string, string[]> = {
  knowledge_base: [
    'create',
    'add_file',
    'update',
    'delete',
    'delete_document',
    'update_document',
    'create_tag',
    'update_tag',
    'delete_tag',
    'add_connector',
    'update_connector',
    'delete_connector',
    'sync_connector',
  ],
  user_table: [
    'create',
    'create_from_file',
    'import_file',
    'delete',
    'insert_row',
    'batch_insert_rows',
    'update_row',
    'delete_row',
    'update_rows_by_filter',
    'delete_rows_by_filter',
    'add_column',
    'rename_column',
    'delete_column',
    'update_column',
  ],
  manage_custom_tool: ['add', 'edit', 'delete'],
  manage_mcp_tool: ['add', 'edit', 'delete'],
  manage_skill: ['add', 'edit', 'delete'],
  manage_credential: ['rename', 'delete'],
  workspace_file: ['write', 'update', 'delete', 'rename', 'patch'],
  download_to_workspace_file: ['*'],
  generate_visualization: ['generate'],
  generate_image: ['generate'],
}

function isWritePermission(userPermission: string): boolean {
  return userPermission === 'write' || userPermission === 'admin'
}

function isActionAllowed(
  toolName: string,
  action: string | undefined,
  userPermission: string
): boolean {
  const writeActions = WRITE_ACTIONS[toolName]
  if (!writeActions) return true
  // '*' means the tool is always a write operation regardless of action field
  if (writeActions.includes('*')) return isWritePermission(userPermission)
  if (action && writeActions.includes(action)) return isWritePermission(userPermission)
  return true
}

/** Registry of all server tools. Tools self-declare their validation schemas. */
const serverToolRegistry: Record<string, BaseServerTool> = {
  [getBlocksMetadataServerTool.name]: getBlocksMetadataServerTool,
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [getExecutionSummaryServerTool.name]: getExecutionSummaryServerTool,
  [getWorkflowLogsServerTool.name]: getWorkflowLogsServerTool,
  [getJobLogsServerTool.name]: getJobLogsServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [makeApiRequestServerTool.name]: makeApiRequestServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [userTableServerTool.name]: userTableServerTool,
  [workspaceFileServerTool.name]: workspaceFileServerTool,
  [downloadToWorkspaceFileServerTool.name]: downloadToWorkspaceFileServerTool,
  [generateVisualizationServerTool.name]: generateVisualizationServerTool,
  [generateImageServerTool.name]: generateImageServerTool,
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

  logger.withMetadata({ messageId: context?.messageId }).debug('Routing to tool', {
    toolName,
  })

  // Action-level permission enforcement for mixed read/write tools
  if (context?.userPermission && WRITE_ACTIONS[toolName]) {
    const p = payload as Record<string, unknown>
    const action = (p?.operation ?? p?.action) as string | undefined
    if (!isActionAllowed(toolName, action, context.userPermission)) {
      const actionLabel = action ? `'${action}' on ` : ''
      throw new Error(
        `Permission denied: ${actionLabel}${toolName} requires write access. You have '${context.userPermission}' permission.`
      )
    }
  }

  assertServerToolNotAborted(context)

  // Validate input if tool declares a schema
  const args = tool.inputSchema ? tool.inputSchema.parse(payload ?? {}) : (payload ?? {})

  assertServerToolNotAborted(context)

  // Execute
  const result = await tool.execute(args, context)

  // Validate output if tool declares a schema
  return tool.outputSchema ? tool.outputSchema.parse(result) : result
}
