import { createLogger } from '@sim/logger'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
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
import { workflowChangeServerTool } from '@/lib/copilot/tools/server/workflow/workflow-change'
import {
  workflowContextExpandServerTool,
  workflowContextGetServerTool,
} from '@/lib/copilot/tools/server/workflow/workflow-context'
import { workflowVerifyServerTool } from '@/lib/copilot/tools/server/workflow/workflow-verify'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

const logger = createLogger('ServerToolRouter')

/** Registry of all server tools. Tools self-declare their validation schemas. */
const serverToolRegistry: Record<string, BaseServerTool> = {
  [getBlocksAndToolsServerTool.name]: getBlocksAndToolsServerTool,
  [getBlocksMetadataServerTool.name]: getBlocksMetadataServerTool,
  [getBlockOptionsServerTool.name]: getBlockOptionsServerTool,
  [getBlockConfigServerTool.name]: getBlockConfigServerTool,
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [getWorkflowConsoleServerTool.name]: getWorkflowConsoleServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [makeApiRequestServerTool.name]: makeApiRequestServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
  [workflowContextGetServerTool.name]: workflowContextGetServerTool,
  [workflowContextExpandServerTool.name]: workflowContextExpandServerTool,
  [workflowChangeServerTool.name]: workflowChangeServerTool,
  [workflowVerifyServerTool.name]: workflowVerifyServerTool,
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

  // Validate input if tool declares a schema
  const args = tool.inputSchema ? tool.inputSchema.parse(payload ?? {}) : (payload ?? {})

  // Execute
  const result = await tool.execute(args, context)

  // Validate output if tool declares a schema
  return tool.outputSchema ? tool.outputSchema.parse(result) : result
}
