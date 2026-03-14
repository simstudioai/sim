import { createLogger } from '@sim/logger'
import { getUserSubscriptionState } from '@/lib/billing/core/subscription'
import { processFileAttachments } from '@/lib/copilot/chat-context'
import { getCopilotToolDescription } from '@/lib/copilot/tool-descriptions'
import { isHosted } from '@/lib/core/config/feature-flags'
import { createMcpToolId } from '@/lib/mcp/utils'
import { getWorkflowById } from '@/lib/workflows/utils'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

const logger = createLogger('CopilotChatPayload')

export interface BuildPayloadParams {
  message: string
  workflowId?: string
  workflowName?: string
  workspaceId?: string
  userId: string
  userMessageId: string
  mode: string
  model: string
  provider?: string
  contexts?: Array<{ type: string; content: string }>
  fileAttachments?: Array<{ id: string; key: string; size: number; [key: string]: unknown }>
  commands?: string[]
  chatId?: string
  prefetch?: boolean
  implicitFeedback?: string
  workspaceContext?: string
  userPermission?: string
  userTimezone?: string
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
  executeLocally?: boolean
  oauth?: { required: boolean; provider: string }
}

/**
 * Build deferred integration tool schemas from the Sim tool registry.
 * Shared by the interactive chat payload builder and the non-interactive
 * block execution route so both paths send the same tool definitions to Go.
 */
export async function buildIntegrationToolSchemas(userId: string): Promise<ToolSchema[]> {
  const integrationTools: ToolSchema[] = []
  try {
    const { createUserToolSchema } = await import('@/tools/params')
    const latestTools = getLatestVersionTools(tools)
    let shouldAppendEmailTagline = false

    try {
      const subscriptionState = await getUserSubscriptionState(userId)
      shouldAppendEmailTagline = subscriptionState.isFree
    } catch (error) {
      logger.warn('Failed to load subscription state for copilot tool descriptions', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    for (const [toolId, toolConfig] of Object.entries(latestTools)) {
      try {
        const userSchema = createUserToolSchema(toolConfig)
        const strippedName = stripVersionSuffix(toolId)
        integrationTools.push({
          name: strippedName,
          description: getCopilotToolDescription(toolConfig, {
            isHosted,
            fallbackName: strippedName,
            appendEmailTagline: shouldAppendEmailTagline,
          }),
          input_schema: userSchema as unknown as Record<string, unknown>,
          defer_loading: true,
          ...(toolConfig.oauth?.required && {
            oauth: {
              required: true,
              provider: toolConfig.oauth.provider,
            },
          }),
        })
      } catch (toolError) {
        logger.warn('Failed to build schema for tool, skipping', {
          toolId,
          error: toolError instanceof Error ? toolError.message : String(toolError),
        })
      }
    }
  } catch (error) {
    logger.warn('Failed to build tool schemas', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return integrationTools
}

/**
 * Build the request payload for the copilot backend.
 */
export async function buildCopilotRequestPayload(
  params: BuildPayloadParams,
  options: {
    selectedModel: string
  }
): Promise<Record<string, unknown>> {
  const {
    message,
    workflowId,
    userId,
    userMessageId,
    mode,
    provider,
    contexts,
    fileAttachments,
    commands,
    chatId,
    prefetch,
    implicitFeedback,
  } = params

  const selectedModel = options.selectedModel

  const effectiveMode = mode === 'agent' ? 'build' : mode
  const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

  const processedFileContents = await processFileAttachments(fileAttachments ?? [], userId)

  let integrationTools: ToolSchema[] = []

  if (effectiveMode === 'build') {
    integrationTools = await buildIntegrationToolSchemas(userId)

    // Discover MCP tools from workspace servers and include as deferred tools
    if (workflowId) {
      try {
        const wf = await getWorkflowById(workflowId)
        if (wf?.workspaceId) {
          const { mcpService } = await import('@/lib/mcp/service')
          const mcpTools = await mcpService.discoverTools(userId, wf.workspaceId)
          for (const mcpTool of mcpTools) {
            integrationTools.push({
              name: createMcpToolId(mcpTool.serverId, mcpTool.name),
              description:
                mcpTool.description || `MCP tool: ${mcpTool.name} (${mcpTool.serverName})`,
              input_schema: mcpTool.inputSchema as unknown as Record<string, unknown>,
            })
          }
          if (mcpTools.length > 0) {
            logger.info('Added MCP tools to copilot payload', { count: mcpTools.length })
          }
        }
      } catch (error) {
        logger.warn('Failed to discover MCP tools for copilot', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return {
    message,
    ...(workflowId ? { workflowId } : {}),
    ...(params.workflowName ? { workflowName: params.workflowName } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    userId,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(provider ? { provider } : {}),
    mode: transportMode,
    messageId: userMessageId,
    ...(contexts && contexts.length > 0 ? { context: contexts } : {}),
    ...(chatId ? { chatId } : {}),
    ...(typeof prefetch === 'boolean' ? { prefetch } : {}),
    ...(implicitFeedback ? { implicitFeedback } : {}),
    ...(processedFileContents.length > 0 ? { fileAttachments: processedFileContents } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(commands && commands.length > 0 ? { commands } : {}),
    ...(params.workspaceContext ? { workspaceContext: params.workspaceContext } : {}),
    ...(params.userPermission ? { userPermission: params.userPermission } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    isHosted,
  }
}
