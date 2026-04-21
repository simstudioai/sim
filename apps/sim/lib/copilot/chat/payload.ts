import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { getToolEntry } from '@/lib/copilot/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { isHosted } from '@/lib/core/config/feature-flags'
import { createMcpToolId } from '@/lib/mcp/utils'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

const logger = createLogger('CopilotChatPayload')
const TOOL_SCHEMA_CACHE_TTL_MS = 30_000

type ToolSchemaCacheEntry = {
  expiresAt: number
  value?: ToolSchema[]
  promise?: Promise<ToolSchema[]>
}

const toolSchemaCache = new Map<string, ToolSchemaCacheEntry>()

interface BuildPayloadParams {
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

interface BuildIntegrationToolSchemasOptions {
  schemaSurface?: 'default' | 'copilot'
}

/**
 * Build deferred integration tool schemas from the Sim tool registry.
 * Shared by the interactive chat payload builder and the non-interactive
 * block execution route so both paths send the same tool definitions to Go.
 */
export async function buildIntegrationToolSchemas(
  userId: string,
  messageId?: string,
  options: BuildIntegrationToolSchemasOptions = { schemaSurface: 'copilot' }
): Promise<ToolSchema[]> {
  const cacheKey = `${userId}:${options.schemaSurface ?? 'copilot'}`
  const now = Date.now()
  const cached = toolSchemaCache.get(cacheKey)
  if (cached?.value && cached.expiresAt > now) {
    return cached.value.map((tool) => ({ ...tool, input_schema: { ...tool.input_schema } }))
  }
  if (cached?.promise) {
    const tools = await cached.promise
    return tools.map((tool) => ({ ...tool, input_schema: { ...tool.input_schema } }))
  }

  const reqLogger = logger.withMetadata({ messageId })
  const promise = (async () => {
    const integrationTools: ToolSchema[] = []
    try {
      const { createUserToolSchema } = await import('@/tools/params')
      const latestTools = getLatestVersionTools(tools)
      let shouldAppendEmailTagline = false

      try {
        const subscription = await getHighestPrioritySubscription(userId)
        shouldAppendEmailTagline = !subscription || !isPaid(subscription.plan)
      } catch (error) {
        reqLogger.warn('Failed to load subscription for copilot tool descriptions', {
          userId,
          error: toError(error).message,
        })
      }

      for (const [toolId, toolConfig] of Object.entries(latestTools)) {
        try {
          const userSchema = createUserToolSchema(toolConfig, {
            surface: options.schemaSurface ?? 'copilot',
          })
          const strippedName = stripVersionSuffix(toolId)
          const catalogEntry = getToolEntry(strippedName)
          integrationTools.push({
            name: strippedName,
            description: getCopilotToolDescription(toolConfig, {
              isHosted,
              fallbackName: strippedName,
              appendEmailTagline: shouldAppendEmailTagline,
            }),
            input_schema: userSchema as unknown as Record<string, unknown>,
            defer_loading: true,
            executeLocally:
              catalogEntry?.clientExecutable === true || catalogEntry?.route === 'client',
            ...(toolConfig.oauth?.required && {
              oauth: {
                required: true,
                provider: toolConfig.oauth.provider,
              },
            }),
          })
        } catch (toolError) {
          logger.warn(
            messageId
              ? `Failed to build schema for tool, skipping [messageId:${messageId}]`
              : 'Failed to build schema for tool, skipping',
            {
              toolId,
              error: toError(toolError).message,
            }
          )
        }
      }
    } catch (error) {
      logger.warn(
        messageId
          ? `Failed to build tool schemas [messageId:${messageId}]`
          : 'Failed to build tool schemas',
        {
          error: toError(error).message,
        }
      )
    }

    toolSchemaCache.set(cacheKey, {
      value: integrationTools,
      expiresAt: Date.now() + TOOL_SCHEMA_CACHE_TTL_MS,
    })

    return integrationTools
  })()

  toolSchemaCache.set(cacheKey, {
    expiresAt: now + TOOL_SCHEMA_CACHE_TTL_MS,
    promise,
  })

  const integrationTools = await promise
  return integrationTools.map((tool) => ({ ...tool, input_schema: { ...tool.input_schema } }))
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

  // Track uploaded files in the DB and build context tags instead of base64 inlining
  const uploadContexts: Array<{ type: string; content: string }> = []
  if (chatId && params.workspaceId && fileAttachments && fileAttachments.length > 0) {
    for (const f of fileAttachments) {
      const filename = (f.filename ?? f.name ?? 'file') as string
      const mediaType = (f.media_type ?? f.mimeType ?? 'application/octet-stream') as string
      try {
        await trackChatUpload(
          params.workspaceId,
          userId,
          chatId,
          f.key,
          filename,
          mediaType,
          f.size
        )
        const lines = [
          `File "${filename}" (${mediaType}, ${f.size} bytes) uploaded.`,
          `Read with: read("uploads/${filename}")`,
          `To save permanently: materialize_file(fileName: "${filename}")`,
        ]
        if (filename.endsWith('.json')) {
          lines.push(
            `To import as a workflow: materialize_file(fileName: "${filename}", operation: "import")`
          )
        }
        uploadContexts.push({
          type: 'uploaded_file',
          content: lines.join('\n'),
        })
      } catch (err) {
        logger.warn('Failed to track chat upload', {
          filename,
          chatId,
          error: toError(err).message,
        })
      }
    }
  }

  const allContexts = [...(contexts ?? []), ...uploadContexts]

  let integrationTools: ToolSchema[] = []

  const payloadLogger = logger.withMetadata({ messageId: userMessageId })

  if (effectiveMode === 'build') {
    integrationTools = await buildIntegrationToolSchemas(userId, userMessageId, {
      schemaSurface: 'copilot',
    })

    // Discover MCP tools from workspace servers and include as deferred tools
    if (params.workspaceId) {
      try {
        const { mcpService } = await import('@/lib/mcp/service')
        const mcpTools = await mcpService.discoverTools(userId, params.workspaceId)
        for (const mcpTool of mcpTools) {
          integrationTools.push({
            name: createMcpToolId(mcpTool.serverId, mcpTool.name),
            description: mcpTool.description || `MCP tool: ${mcpTool.name} (${mcpTool.serverName})`,
            input_schema: mcpTool.inputSchema as unknown as Record<string, unknown>,
            executeLocally: false,
          })
        }
        if (mcpTools.length > 0) {
          logger.error(
            userMessageId
              ? `Added MCP tools to copilot payload [messageId:${userMessageId}]`
              : 'Added MCP tools to copilot payload',
            { count: mcpTools.length }
          )
        }
      } catch (error) {
        logger.warn(
          userMessageId
            ? `Failed to discover MCP tools for copilot [messageId:${userMessageId}]`
            : 'Failed to discover MCP tools for copilot',
          {
            error: toError(error).message,
          }
        )
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
    ...(allContexts.length > 0 ? { context: allContexts } : {}),
    ...(chatId ? { chatId } : {}),
    ...(typeof prefetch === 'boolean' ? { prefetch } : {}),
    ...(implicitFeedback ? { implicitFeedback } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(commands && commands.length > 0 ? { commands } : {}),
    ...(params.workspaceContext ? { workspaceContext: params.workspaceContext } : {}),
    ...(params.userPermission ? { userPermission: params.userPermission } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    isHosted,
  }
}
