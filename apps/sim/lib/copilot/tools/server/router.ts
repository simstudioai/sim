import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getBlocksAndToolsServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { listGDriveFilesServerTool } from '@/lib/copilot/tools/server/gdrive/list-files'
import { readGDriveFileServerTool } from '@/lib/copilot/tools/server/gdrive/read-file'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { getEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/get-environment-variables'
import { getOAuthCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-oauth-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getWorkflowConsoleServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-console'
import {
  ExecuteResponseSuccessSchema,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetTriggerBlocksInput,
  GetTriggerBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Register tools
serverToolRegistry[getBlocksAndToolsServerTool.name] = getBlocksAndToolsServerTool
serverToolRegistry[getBlocksMetadataServerTool.name] = getBlocksMetadataServerTool
serverToolRegistry[getTriggerBlocksServerTool.name] = getTriggerBlocksServerTool
serverToolRegistry[editWorkflowServerTool.name] = editWorkflowServerTool
serverToolRegistry[getWorkflowConsoleServerTool.name] = getWorkflowConsoleServerTool
serverToolRegistry[searchDocumentationServerTool.name] = searchDocumentationServerTool
serverToolRegistry[searchOnlineServerTool.name] = searchOnlineServerTool
serverToolRegistry[getEnvironmentVariablesServerTool.name] = getEnvironmentVariablesServerTool
serverToolRegistry[setEnvironmentVariablesServerTool.name] = setEnvironmentVariablesServerTool
serverToolRegistry[listGDriveFilesServerTool.name] = listGDriveFilesServerTool
serverToolRegistry[readGDriveFileServerTool.name] = readGDriveFileServerTool
serverToolRegistry[getOAuthCredentialsServerTool.name] = getOAuthCredentialsServerTool
serverToolRegistry[makeApiRequestServerTool.name] = makeApiRequestServerTool

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: { userId: string }
): Promise<any> {
  const tool = serverToolRegistry[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }
  logger.debug('Routing to tool', {
    toolName,
    payloadPreview: (() => {
      try {
        return JSON.stringify(payload).slice(0, 200)
      } catch {
        return undefined
      }
    })(),
  })

  let args: any = payload || {}
  if (toolName === 'get_blocks_and_tools') {
    args = GetBlocksAndToolsInput.parse(args)
  }
  if (toolName === 'get_blocks_metadata') {
    args = GetBlocksMetadataInput.parse(args)
  }
  if (toolName === 'get_trigger_blocks') {
    args = GetTriggerBlocksInput.parse(args)
  }

  const result = await tool.execute(args, context)

  if (toolName === 'get_blocks_and_tools') {
    return GetBlocksAndToolsResult.parse(result)
  }
  if (toolName === 'get_blocks_metadata') {
    return GetBlocksMetadataResult.parse(result)
  }
  if (toolName === 'get_trigger_blocks') {
    return GetTriggerBlocksResult.parse(result)
  }

  return result
}
