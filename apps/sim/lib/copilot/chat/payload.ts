import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { getToolEntry } from '@/lib/copilot/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { isHosted } from '@/lib/core/config/feature-flags'
import { buildMothershipToolsForRequest } from '@/lib/mothership/settings/runtime'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'

const logger = createLogger('CopilotChatPayload')
const INTEGRATION_TOOL_SCHEMA_CACHE_TTL_MS = 5_000
const INTEGRATION_TOOL_SCHEMA_CACHE_MAX_ENTRIES = 500

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
  includeMothershipTools?: boolean
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
  executeLocally?: boolean
  params?: Record<string, unknown>
  oauth?: { required: boolean; provider: string }
}

interface BuildIntegrationToolSchemasOptions {
  schemaSurface?: 'default' | 'copilot'
}

interface IntegrationToolSchemaCacheEntry {
  promise: Promise<ToolSchema[]>
}

const integrationToolSchemaCache = new LRUCache<string, IntegrationToolSchemaCacheEntry>({
  max: INTEGRATION_TOOL_SCHEMA_CACHE_MAX_ENTRIES,
  ttl: INTEGRATION_TOOL_SCHEMA_CACHE_TTL_MS,
})

function getIntegrationToolSchemaCacheKey(
  userId: string,
  workspaceId: string | undefined,
  schemaSurface: string
): string {
  return JSON.stringify([userId, workspaceId ?? null, schemaSurface])
}

function cloneToolSchemas(toolSchemas: ToolSchema[]): ToolSchema[] {
  return toolSchemas.map((tool) => {
    const cloned: ToolSchema = {
      ...tool,
      input_schema: { ...tool.input_schema },
    }
    if (tool.params) cloned.params = { ...tool.params }
    if (tool.oauth) cloned.oauth = { ...tool.oauth }
    return cloned
  })
}

export function clearIntegrationToolSchemaCacheForTests(): void {
  integrationToolSchemaCache.clear()
}

/**
 * Build deferred integration tool schemas from the Sim tool registry.
 * Shared by the interactive chat payload builder and the non-interactive
 * block execution route so both paths send the same tool definitions to Go.
 *
 * When `workspaceId` is provided the user's workspace permission config is
 * loaded once and used to skip any tool whose owning block is not in the
 * workspace's `allowedIntegrations` allowlist.
 */
export async function buildIntegrationToolSchemas(
  userId: string,
  messageId?: string,
  options: BuildIntegrationToolSchemasOptions = { schemaSurface: 'copilot' },
  workspaceId?: string
): Promise<ToolSchema[]> {
  const schemaSurface = options.schemaSurface ?? 'copilot'
  const cacheKey = getIntegrationToolSchemaCacheKey(userId, workspaceId, schemaSurface)
  const cached = integrationToolSchemaCache.get(cacheKey)
  if (cached) {
    return cloneToolSchemas(await cached.promise)
  }

  const promise = buildIntegrationToolSchemasUncached(
    userId,
    messageId,
    { schemaSurface },
    workspaceId
  ).catch((error) => {
    integrationToolSchemaCache.delete(cacheKey)
    throw error
  })

  integrationToolSchemaCache.set(cacheKey, {
    promise,
  })

  return cloneToolSchemas(await promise)
}

async function buildIntegrationToolSchemasUncached(
  userId: string,
  messageId: string | undefined,
  options: Required<BuildIntegrationToolSchemasOptions>,
  workspaceId?: string
): Promise<ToolSchema[]> {
  const reqLogger = logger.withMetadata({ messageId })
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

    let allowedIntegrations: Set<string> | null = null
    let toolIdToBlockType: Map<string, string> | null = null
    if (workspaceId) {
      try {
        const [{ getUserPermissionConfig }, { registry: blockRegistry }] = await Promise.all([
          import('@/ee/access-control/utils/permission-check'),
          import('@/blocks/registry'),
        ])
        const permissionConfig = await getUserPermissionConfig(userId, workspaceId)
        if (permissionConfig?.allowedIntegrations) {
          allowedIntegrations = new Set(
            permissionConfig.allowedIntegrations.map((i) => i.toLowerCase())
          )
          toolIdToBlockType = new Map()
          for (const [blockType, blockConfig] of Object.entries(blockRegistry)) {
            const access = (blockConfig as { tools?: { access?: string[] } }).tools?.access
            if (!access) continue
            for (const toolId of access) {
              toolIdToBlockType.set(stripVersionSuffix(toolId), blockType.toLowerCase())
            }
          }
        }
      } catch (error) {
        reqLogger.warn('Failed to load permission config for tool schema filter', {
          userId,
          workspaceId,
          error: toError(error).message,
        })
      }
    }

    for (const [toolId, toolConfig] of Object.entries(latestTools)) {
      try {
        const strippedName = stripVersionSuffix(toolId)
        if (allowedIntegrations && toolIdToBlockType) {
          const owningBlock = toolIdToBlockType.get(strippedName)
          if (owningBlock && !allowedIntegrations.has(owningBlock)) {
            continue
          }
        }
        const userSchema = createUserToolSchema(toolConfig, {
          surface: options.schemaSurface,
        })
        const catalogEntry = getToolEntry(strippedName)
        integrationTools.push({
          name: strippedName,
          description: getCopilotToolDescription(toolConfig, {
            isHosted,
            fallbackName: strippedName,
            appendEmailTagline: shouldAppendEmailTagline,
          }),
          input_schema: { ...userSchema },
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

  // Track uploaded files in the DB and build context tags instead of base64 inlining
  const uploadContexts: Array<{ type: string; content: string }> = []
  if (chatId && params.workspaceId && fileAttachments && fileAttachments.length > 0) {
    for (const f of fileAttachments) {
      const filename = (f.filename ?? f.name ?? 'file') as string
      const mediaType = (f.media_type ?? f.mimeType ?? 'application/octet-stream') as string
      try {
        const { displayName } = await trackChatUpload(
          params.workspaceId,
          userId,
          chatId,
          f.key,
          filename,
          mediaType,
          f.size
        )
        const lines = [
          `File "${displayName}" (${mediaType}, ${f.size} bytes) uploaded.`,
          `Read with: read("uploads/${displayName}")`,
          `To save permanently: materialize_file(fileName: "${displayName}")`,
        ]
        if (displayName.endsWith('.json')) {
          lines.push(
            `To import as a workflow: materialize_file(fileName: "${displayName}", operation: "import")`
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
  let mothershipTools: ToolSchema[] = []
  let workspaceContext = params.workspaceContext

  const payloadLogger = logger.withMetadata({ messageId: userMessageId })

  if (effectiveMode === 'build') {
    integrationTools = await buildIntegrationToolSchemas(
      userId,
      userMessageId,
      { schemaSurface: 'copilot' },
      params.workspaceId
    )

    if (params.includeMothershipTools && params.workspaceId) {
      try {
        const runtimeTools = await buildMothershipToolsForRequest({
          workspaceId: params.workspaceId,
          userId,
        })
        mothershipTools = runtimeTools.tools
        if (runtimeTools.catalogContext) {
          workspaceContext = [workspaceContext, runtimeTools.catalogContext]
            .filter(Boolean)
            .join('\n\n')
        }
      } catch (error) {
        logger.warn(
          userMessageId
            ? `Failed to build Mothership tools [messageId:${userMessageId}]`
            : 'Failed to build Mothership tools',
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
    ...(mothershipTools.length > 0 ? { mothershipTools } : {}),
    ...(commands && commands.length > 0 ? { commands } : {}),
    ...(workspaceContext ? { workspaceContext } : {}),
    ...(params.userPermission ? { userPermission: params.userPermission } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    isHosted,
  }
}
