import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { getBlockVisibilityForCopilot, visibilitySignature } from '@/lib/copilot/block-visibility'
import type { VfsSnapshotV1 } from '@/lib/copilot/generated/vfs-snapshot-v1'
import {
  filterExposedIntegrationTools,
  getExposedIntegrationTools,
} from '@/lib/copilot/integration-tools'
import { buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'
import { getToolEntry } from '@/lib/copilot/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { isE2BDocEnabled, isHosted } from '@/lib/core/config/env-flags'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { buildArchiveExtractGuidance, isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import { stripVersionSuffix } from '@/tools/utils'

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
  contexts?: Array<{ type: string; content: string; tag?: string; path?: string }>
  /** MCP servers explicitly tagged on this turn. Untagged servers stay unavailable. */
  mcpServerIds?: string[]
  fileAttachments?: Array<{ id: string; key: string; size: number; [key: string]: unknown }>
  commands?: string[]
  chatId?: string
  prefetch?: boolean
  implicitFeedback?: string
  workspaceContext?: string
  vfs?: VfsSnapshotV1
  userPermission?: string
  /** Plan/flag-gated org capabilities (e.g. "custom-blocks") the mothership gates tools/prompts on. */
  entitlements?: string[]
  userTimezone?: string
  userMetadata?: {
    name?: string
    email?: string
    timezone?: string
  }
}

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
  outputs?: Record<string, unknown>
  defer_loading?: boolean
  executeLocally?: boolean
  params?: Record<string, unknown>
  /** Canonical integration service/folder (e.g. "slack"), for server-side grouping. */
  service?: string
  /**
   * Operation stem within the service — the VFS doc filename without `.json`
   * (e.g. "list_users" for id "slack_list_users"). Stamped so the server can
   * hand agents the exact `components/integrations/{service}/{operation}.json`
   * path instead of making them derive it from the id (deriving is how the id
   * gets guessed as the filename).
   */
  operation?: string
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
  schemaSurface: string,
  visSignature: string
): string {
  // The visibility signature keys the entry to the viewer's gated projection —
  // two users in one workspace with different preview reveals must not share.
  return JSON.stringify([userId, workspaceId ?? null, schemaSurface, visSignature])
}

function cloneToolSchemas(toolSchemas: ToolSchema[]): ToolSchema[] {
  return toolSchemas.map((tool) => {
    const cloned: ToolSchema = {
      ...tool,
      input_schema: { ...tool.input_schema },
    }
    if (tool.params) cloned.params = { ...tool.params }
    if (tool.outputs) cloned.outputs = structuredClone(tool.outputs)
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
  const vis = await getBlockVisibilityForCopilot(userId, workspaceId)
  const cacheKey = getIntegrationToolSchemaCacheKey(
    userId,
    workspaceId,
    schemaSurface,
    visibilitySignature(vis)
  )
  const cached = integrationToolSchemaCache.get(cacheKey)
  if (cached) {
    return cloneToolSchemas(await cached.promise)
  }

  const promise = buildIntegrationToolSchemasUncached(
    userId,
    messageId,
    { schemaSurface },
    workspaceId,
    vis
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
  workspaceId?: string,
  vis: BlockVisibilityState | null = null
): Promise<ToolSchema[]> {
  const reqLogger = logger.withMetadata({ messageId })
  const integrationTools: ToolSchema[] = []
  try {
    const { createUserToolSchema } = await import('@/tools/params')
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
        const [{ getUserPermissionConfig }, { getAllBlocks }] = await Promise.all([
          import('@/ee/access-control/utils/permission-check'),
          import('@/blocks/registry'),
        ])
        const permissionConfig = await getUserPermissionConfig(userId, workspaceId)
        if (permissionConfig?.allowedIntegrations) {
          allowedIntegrations = new Set(
            permissionConfig.allowedIntegrations.map((i) => i.toLowerCase())
          )
          toolIdToBlockType = new Map()
          for (const blockConfig of getAllBlocks()) {
            const access = blockConfig.tools?.access
            if (!access) continue
            for (const toolId of access) {
              toolIdToBlockType.set(stripVersionSuffix(toolId), blockConfig.type.toLowerCase())
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

    const exposedTools = filterExposedIntegrationTools(getExposedIntegrationTools(), vis)
    for (const { toolId, config: toolConfig, service, operation } of exposedTools) {
      try {
        if (allowedIntegrations && toolIdToBlockType) {
          const owningBlock = toolIdToBlockType.get(stripVersionSuffix(toolId))
          if (owningBlock && !allowedIntegrations.has(owningBlock)) {
            continue
          }
        }
        const userSchema = createUserToolSchema(toolConfig, {
          surface: options.schemaSurface,
          // On hosted deployments the executor injects hosted keys server-side,
          // so the gateway schema must not force the model to supply one (the
          // model never sees the key either way).
          hostedKeySupport: isHosted,
        })
        const catalogEntry = getToolEntry(toolId)
        integrationTools.push({
          name: toolId,
          service,
          operation,
          description: getCopilotToolDescription(toolConfig, {
            isHosted,
            fallbackName: toolId,
            appendEmailTagline: shouldAppendEmailTagline,
          }),
          input_schema: { ...userSchema },
          ...(toolConfig.outputs && {
            outputs: Object.fromEntries(
              Object.entries(toolConfig.outputs)
                .filter(([, output]) => output != null)
                .map(([key, output]) => [
                  key,
                  { type: output.type, description: output.description },
                ])
            ),
          }),
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
  const uploadContexts: Array<{ type: string; content: string; tag?: string; path?: string }> = []
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
          f.size,
          userMessageId
        )
        // Encode the read path per the percent-encoded VFS convention (matches
        // files/ and the uploads glob output). The materialize_file `fileName`
        // arg stays the raw display name — the upload resolver accepts both.
        let encodedUploadName = displayName
        try {
          encodedUploadName = encodeVfsSegment(displayName)
        } catch {
          encodedUploadName = displayName
        }
        let lines: string[]
        if (isArchiveFileName(displayName)) {
          // A .zip is stored in uploads/ but its contents aren't readable until
          // the agent extracts it once into workspace files/ (explicit step).
          lines = [
            `Archive "${displayName}" (${mediaType}, ${f.size} bytes) uploaded.`,
            buildArchiveExtractGuidance(displayName),
          ]
        } else {
          lines = [
            `File "${displayName}" (${mediaType}, ${f.size} bytes) uploaded.`,
            `Read with: read("uploads/${encodedUploadName}")`,
            `To save permanently: materialize_file(fileName: "${displayName}")`,
          ]
          if (displayName.endsWith('.json')) {
            lines.push(
              `To import as a workflow: materialize_file(fileName: "${displayName}", operation: "import")`
            )
          }
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
  const payloadLogger = logger.withMetadata({ messageId: userMessageId })

  // "superagent" is a legacy wire value for Direct Action mode; both modes
  // execute connected-service operations through the main-agent gateway.
  if (effectiveMode === 'build' || effectiveMode === 'superagent') {
    integrationTools = await buildIntegrationToolSchemas(
      userId,
      userMessageId,
      { schemaSurface: 'copilot' },
      params.workspaceId
    )
  }

  if (params.workspaceId && params.mcpServerIds?.length) {
    mothershipTools = await buildTaggedMcpToolSchemas(
      userId,
      params.workspaceId,
      params.mcpServerIds
    )
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
    ...(params.workspaceContext ? { workspaceContext: params.workspaceContext } : {}),
    ...(params.vfs ? { vfs: params.vfs } : {}),
    ...(params.userPermission ? { userPermission: params.userPermission } : {}),
    ...(params.entitlements?.length ? { entitlements: params.entitlements } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    ...(params.userMetadata &&
    (params.userMetadata.name || params.userMetadata.email || params.userMetadata.timezone)
      ? { userMetadata: params.userMetadata }
      : {}),
    // Tell the copilot file subagent which document toolchain to write. Emitted
    // only in Python mode so the JS path sends no new field (Go defaults to js).
    ...(isE2BDocEnabled ? { docCompiler: 'python' } : {}),
    isHosted,
  }
}
