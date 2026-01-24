import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getBlockConfigServerTool } from '@/lib/copilot/tools/server/blocks/get-block-config'
import { getBlockOptionsServerTool } from '@/lib/copilot/tools/server/blocks/get-block-options'
import { getBlocksAndToolsServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getWorkflowConsoleServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-console'
import {
  ExecuteResponseSuccessSchema,
  GetBlockConfigInput,
  GetBlockConfigResult,
  GetBlockOptionsInput,
  GetBlockOptionsResult,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetTriggerBlocksInput,
  GetTriggerBlocksResult,
  KnowledgeBaseArgsSchema,
} from '@/lib/copilot/tools/shared/schemas'

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Register tools
serverToolRegistry[getBlocksAndToolsServerTool.name] = getBlocksAndToolsServerTool
serverToolRegistry[getBlocksMetadataServerTool.name] = getBlocksMetadataServerTool
serverToolRegistry[getBlockOptionsServerTool.name] = getBlockOptionsServerTool
serverToolRegistry[getBlockConfigServerTool.name] = getBlockConfigServerTool
serverToolRegistry[getTriggerBlocksServerTool.name] = getTriggerBlocksServerTool
serverToolRegistry[editWorkflowServerTool.name] = editWorkflowServerTool
serverToolRegistry[getWorkflowConsoleServerTool.name] = getWorkflowConsoleServerTool
serverToolRegistry[searchDocumentationServerTool.name] = searchDocumentationServerTool
serverToolRegistry[searchOnlineServerTool.name] = searchOnlineServerTool
serverToolRegistry[setEnvironmentVariablesServerTool.name] = setEnvironmentVariablesServerTool
serverToolRegistry[getCredentialsServerTool.name] = getCredentialsServerTool
serverToolRegistry[makeApiRequestServerTool.name] = makeApiRequestServerTool
serverToolRegistry[knowledgeBaseServerTool.name] = knowledgeBaseServerTool

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
  if (toolName === 'get_block_options') {
    args = GetBlockOptionsInput.parse(args)
  }
  if (toolName === 'get_block_config') {
    args = GetBlockConfigInput.parse(args)
  }
  if (toolName === 'get_trigger_blocks') {
    args = GetTriggerBlocksInput.parse(args)
  }
  if (toolName === 'knowledge_base') {
    args = KnowledgeBaseArgsSchema.parse(args)
  }

  const result = await tool.execute(args, context)

  if (toolName === 'get_blocks_and_tools') {
    return GetBlocksAndToolsResult.parse(result)
  }
  if (toolName === 'get_blocks_metadata') {
    return GetBlocksMetadataResult.parse(result)
  }
  if (toolName === 'get_block_options') {
    return GetBlockOptionsResult.parse(result)
  }
  if (toolName === 'get_block_config') {
    return GetBlockConfigResult.parse(result)
  }
  if (toolName === 'get_trigger_blocks') {
    return GetTriggerBlocksResult.parse(result)
  }

  return result
}
