import { createLogger } from '@sim/logger'
import { processFileAttachments } from '@/lib/copilot/chat-context'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { env } from '@/lib/core/config/env'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

const logger = createLogger('CopilotChatPayload')

export interface BuildPayloadParams {
  message: string
  workflowId: string
  userId: string
  userMessageId: string
  mode: string
  model: string
  conversationHistory?: unknown[]
  contexts?: Array<{ type: string; content: string }>
  fileAttachments?: Array<{ id: string; key: string; size: number; [key: string]: unknown }>
  commands?: string[]
  chatId?: string
  implicitFeedback?: string
}

interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
  executeLocally?: boolean
  oauth?: { required: boolean; provider: string }
}

interface CredentialsPayload {
  oauth: Record<
    string,
    { accessToken: string; accountId: string; name: string; expiresAt?: string }
  >
  apiKeys: string[]
  metadata?: {
    connectedOAuth: Array<{ provider: string; name: string; scopes?: string[] }>
    configuredApiKeys: string[]
  }
}

type MessageContent = string | Array<{ type: string; text?: string; [key: string]: unknown }>

interface ConversationMessage {
  role: string
  content: MessageContent
}

function buildProviderConfig(selectedModel: string): CopilotProviderConfig | undefined {
  const defaults = getCopilotModel('chat')
  const envModel = env.COPILOT_MODEL || defaults.model
  const providerEnv = env.COPILOT_PROVIDER

  if (!providerEnv) return undefined

  if (providerEnv === 'azure-openai') {
    return {
      provider: 'azure-openai',
      model: envModel,
      apiKey: env.AZURE_OPENAI_API_KEY,
      apiVersion: 'preview',
      endpoint: env.AZURE_OPENAI_ENDPOINT,
    }
  }

  if (providerEnv === 'vertex') {
    return {
      provider: 'vertex',
      model: envModel,
      apiKey: env.COPILOT_API_KEY,
      vertexProject: env.VERTEX_PROJECT,
      vertexLocation: env.VERTEX_LOCATION,
    }
  }

  return {
    provider: providerEnv as Exclude<string, 'azure-openai' | 'vertex'>,
    model: selectedModel,
    apiKey: env.COPILOT_API_KEY,
  } as CopilotProviderConfig
}

/**
 * Build the request payload for the copilot backend.
 */
export async function buildCopilotRequestPayload(
  params: BuildPayloadParams,
  options: {
    providerConfig?: CopilotProviderConfig
    selectedModel: string
  }
): Promise<Record<string, unknown>> {
  const {
    message,
    workflowId,
    userId,
    userMessageId,
    mode,
    conversationHistory = [],
    contexts,
    fileAttachments,
    commands,
    chatId,
    implicitFeedback,
  } = params

  const selectedModel = options.selectedModel
  const providerConfig = options.providerConfig ?? buildProviderConfig(selectedModel)

  const effectiveMode = mode === 'agent' ? 'build' : mode
  const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

  const processedFileContents = await processFileAttachments(fileAttachments ?? [], userId)

  const messages: ConversationMessage[] = []
  for (const msg of conversationHistory as Array<Record<string, unknown>>) {
    const msgAttachments = msg.fileAttachments as Array<Record<string, unknown>> | undefined
    if (Array.isArray(msgAttachments) && msgAttachments.length > 0) {
      const content: Array<{ type: string; text?: string; [key: string]: unknown }> = [
        { type: 'text', text: msg.content as string },
      ]
      const processedHistoricalAttachments = await processFileAttachments(
        (msgAttachments as BuildPayloadParams['fileAttachments']) ?? [],
        userId
      )
      for (const fileContent of processedHistoricalAttachments) {
        content.push(fileContent)
      }
      messages.push({ role: msg.role as string, content })
    } else {
      messages.push({ role: msg.role as string, content: msg.content as string })
    }
  }

  if (implicitFeedback) {
    messages.push({ role: 'system', content: implicitFeedback })
  }

  if (processedFileContents.length > 0) {
    const content: Array<{ type: string; text?: string; [key: string]: unknown }> = [
      { type: 'text', text: message },
    ]
    for (const fileContent of processedFileContents) {
      content.push(fileContent)
    }
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: message })
  }

  const integrationTools: ToolSchema[] = []
  let credentials: CredentialsPayload | null = null

  if (effectiveMode === 'build') {
    // function_execute sandbox tool is now defined in Go — no need to send it

    try {
      const rawCredentials = await getCredentialsServerTool.execute({ workflowId }, { userId })

      const oauthMap: CredentialsPayload['oauth'] = {}
      const connectedOAuth: Array<{ provider: string; name: string; scopes?: string[] }> = []
      for (const cred of rawCredentials?.oauth?.connected?.credentials ?? []) {
        if (cred.accessToken) {
          oauthMap[cred.provider] = {
            accessToken: cred.accessToken,
            accountId: cred.id,
            name: cred.name,
          }
          connectedOAuth.push({ provider: cred.provider, name: cred.name })
        }
      }

      credentials = {
        oauth: oauthMap,
        apiKeys: rawCredentials?.environment?.variableNames ?? [],
        metadata: {
          connectedOAuth,
          configuredApiKeys: rawCredentials?.environment?.variableNames ?? [],
        },
      }
    } catch (error) {
      logger.warn('Failed to fetch credentials for build payload', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    try {
      const { createUserToolSchema } = await import('@/tools/params')
      const latestTools = getLatestVersionTools(tools)

      for (const [toolId, toolConfig] of Object.entries(latestTools)) {
        try {
          const userSchema = createUserToolSchema(toolConfig)
          const strippedName = stripVersionSuffix(toolId)
          integrationTools.push({
            name: strippedName,
            description: toolConfig.description || toolConfig.name || strippedName,
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
      logger.warn('Failed to build tool schemas for payload', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    message,
    workflowId,
    userId,
    model: selectedModel,
    mode: transportMode,
    messageId: userMessageId,
    version: SIM_AGENT_VERSION,
    ...(providerConfig ? { provider: providerConfig } : {}),
    ...(contexts && contexts.length > 0 ? { context: contexts } : {}),
    ...(chatId ? { chatId } : {}),
    ...(processedFileContents.length > 0 ? { fileAttachments: processedFileContents } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(credentials ? { credentials } : {}),
    ...(commands && commands.length > 0 ? { commands } : {}),
  }
}
