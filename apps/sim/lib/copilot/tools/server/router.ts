import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  CreateFile,
  DeleteFile,
  DownloadToWorkspaceFile,
  GenerateImage,
  GenerateVisualization,
  KnowledgeBase,
  ManageCredential,
  ManageCustomTool,
  ManageMcpTool,
  ManageSkill,
  RenameFile,
  UserTable,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { createFileServerTool } from '@/lib/copilot/tools/server/files/create-file'
import { deleteFileServerTool } from '@/lib/copilot/tools/server/files/delete-file'
import { downloadToWorkspaceFileServerTool } from '@/lib/copilot/tools/server/files/download-to-workspace-file'
import { editContentServerTool } from '@/lib/copilot/tools/server/files/edit-content'
import { renameFileServerTool } from '@/lib/copilot/tools/server/files/rename-file'
import { workspaceFileServerTool } from '@/lib/copilot/tools/server/files/workspace-file'
import { validateGeneratedToolPayload } from '@/lib/copilot/tools/server/generated-schema'
import { generateImageServerTool } from '@/lib/copilot/tools/server/image/generate-image'
import { getJobLogsServerTool } from '@/lib/copilot/tools/server/jobs/get-job-logs'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { userTableServerTool } from '@/lib/copilot/tools/server/table/user-table'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { generateVisualizationServerTool } from '@/lib/copilot/tools/server/visualization/generate-visualization'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getExecutionSummaryServerTool } from '@/lib/copilot/tools/server/workflow/get-execution-summary'
import { getWorkflowLogsServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-logs'

export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const logger = createLogger('ServerToolRouter')

const WRITE_ACTIONS: Record<string, string[]> = {
  [KnowledgeBase.id]: [
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
  [UserTable.id]: [
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
  [ManageCustomTool.id]: ['add', 'edit', 'delete'],
  [ManageMcpTool.id]: ['add', 'edit', 'delete'],
  [ManageSkill.id]: ['add', 'edit', 'delete'],
  [ManageCredential.id]: ['rename', 'delete'],
  [WorkspaceFile.id]: ['create', 'append', 'update', 'delete', 'rename', 'patch'],
  [editContentServerTool.name]: ['*'],
  [CreateFile.id]: ['*'],
  [RenameFile.id]: ['*'],
  [DeleteFile.id]: ['*'],
  [DownloadToWorkspaceFile.id]: ['*'],
  [GenerateVisualization.id]: ['generate'],
  [GenerateImage.id]: ['generate'],
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
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [userTableServerTool.name]: userTableServerTool,
  [workspaceFileServerTool.name]: workspaceFileServerTool,
  [editContentServerTool.name]: editContentServerTool,
  [createFileServerTool.name]: createFileServerTool,
  [renameFileServerTool.name]: renameFileServerTool,
  [deleteFileServerTool.name]: deleteFileServerTool,
  [downloadToWorkspaceFileServerTool.name]: downloadToWorkspaceFileServerTool,
  [generateVisualizationServerTool.name]: generateVisualizationServerTool,
  [generateImageServerTool.name]: generateImageServerTool,
}

export function getRegisteredServerToolNames(): string[] {
  return Object.keys(serverToolRegistry)
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolContext
): Promise<unknown> {
  const tool = serverToolRegistry[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug(
    context?.messageId ? `Routing to tool [messageId:${context.messageId}]` : 'Routing to tool',
    { toolName }
  )

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

  assertServerToolNotAborted(
    context,
    `User stop signal aborted ${toolName} before payload normalization`
  )

  // Go injects chatId/workspaceId and may wrap the model's args inside a
  // nested "args" object. Unwrap that before validation so the generated
  // JSON Schema sees the flat tool contract shape.
  let normalizedPayload = payload ?? {}
  if (
    normalizedPayload &&
    typeof normalizedPayload === 'object' &&
    !Array.isArray(normalizedPayload)
  ) {
    const raw = normalizedPayload as Record<string, unknown>
    if (raw.args && typeof raw.args === 'object' && !raw.operation) {
      const nested = raw.args as Record<string, unknown>
      normalizedPayload = { ...nested, ...raw, args: undefined }
    }
  }

  const args = tool.inputSchema
    ? tool.inputSchema.parse(normalizedPayload)
    : validateGeneratedToolPayload(toolName, 'parameters', normalizedPayload)

  assertServerToolNotAborted(context, `User stop signal aborted ${toolName} after validation`)

  // Execute
  const result = await tool.execute(args, context)

  // Validate output if tool declares a schema; otherwise fall back to the
  // generated JSON schema contract emitted from Go.
  return tool.outputSchema
    ? tool.outputSchema.parse(result)
    : validateGeneratedToolPayload(toolName, 'resultSchema', result)
}
