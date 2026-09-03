import type { BrowserKnownSession } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { isPermissionType, permissionSatisfies } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { EnvCapabilityConfigurationError } from '@/lib/core/config/env-capabilities'
import { isHosted } from '@/lib/core/config/env-flags'
import { isOAuthServiceDeploymentAvailable } from '@/lib/integrations/availability.server'
import {
  getBlockVisibilityForCopilot,
  visibilitySignature,
} from '@/lib/mothership/block-visibility'
import type { ChatRequest } from '@/lib/mothership/generated/protocol'
import {
  type IntegrationGateConfig,
  integrationGateSignature,
  projectIntegrationToolsForViewer,
} from '@/lib/mothership/integration-tool-projection'
import { buildTaggedMcpToolSchemas } from '@/lib/mothership/mcp-tools'
import { getToolEntry } from '@/lib/mothership/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/mothership/tools/descriptions'
import { encodeVfsSegment } from '@/lib/mothership/vfs/path-utils'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { buildArchiveExtractGuidance, isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import { deriveHostedApiKeySupport } from '@/tools/hosted-api-key'

const logger = createLogger('CopilotChatPayload')
const INTEGRATION_TOOL_SCHEMA_CACHE_TTL_MS = 5_000
const INTEGRATION_TOOL_SCHEMA_CACHE_MAX_ENTRIES = 500

interface BuildPayloadParams {
  message: string
  workflowId?: string
  workflowName?: string
  /** Required by the wire contract: both branches resolve it before building (the
   * workspace-scoped contract requires it; the workflow branch derives it from the
   * workflow). A missing value used to make the worker fabricate a random identity. */
  workspaceId: string
  userId: string
  userMessageId: string
  mode: string
  model: string
  provider?: string
  contexts?: Array<{ type: string; content: string; tag?: string; path?: string }>
  /**
   * MCP servers enabled for this chat — every server tagged on this or any
   * earlier turn. Servers never tagged in the chat stay unavailable.
   */
  mcpServerIds?: string[]
  fileAttachments?: Array<{ id: string; key: string; size: number; [key: string]: unknown }>
  commands?: string[]
  chatId?: string
  prefetch?: boolean
  implicitFeedback?: string
  userPermission?: string
  /** Plan/flag-gated org capabilities (e.g. "custom-blocks") the mothership gates tools/prompts on. */
  userTimezone?: string
  /** Per-turn model effort dial (user-selected in the composer). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  desktopLocalFilesystem?: boolean
  browser?: boolean
  terminalCapable?: boolean
  terminals?: Array<{
    id: string
    cwd?: string
    running?: string
    interactive?: boolean
    active?: boolean
  }>
  browserSessions?: BrowserKnownSession[]
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
  visSignature: string,
  gateSignature: string
): string {
  // The visibility signature keys the entry to the viewer's gated projection —
  // two users in one workspace with different preview reveals must not share.
  // The gate signature does the same for permission-group policy, so an admin's
  // change takes effect on the next build rather than when the entry expires.
  return JSON.stringify([userId, workspaceId ?? null, schemaSurface, visSignature, gateSignature])
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
  // Resolved before the key, not inside the cached build, so the entry is keyed
  // to the policy it was produced under. The read this adds is cheap next to
  // what the entry caches: a user-tool schema per exposed integration tool.
  let permissionConfig: IntegrationGateConfig | null = null
  if (workspaceId) {
    const { getUserPermissionConfig } = await import('@/ee/access-control/utils/permission-check')
    permissionConfig = await getUserPermissionConfig(userId, workspaceId)
  }
  const cacheKey = getIntegrationToolSchemaCacheKey(
    userId,
    workspaceId,
    schemaSurface,
    visibilitySignature(vis),
    integrationGateSignature(permissionConfig)
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
    vis,
    permissionConfig
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
  vis: BlockVisibilityState | null = null,
  permissionConfig: IntegrationGateConfig | null = null
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

    const { tools: exposedTools } = projectIntegrationToolsForViewer(vis, permissionConfig)
    for (const { toolId, config: toolConfig, service, operation } of exposedTools) {
      try {
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
            hostedApiKey: deriveHostedApiKeySupport(toolConfig.hosting),
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
          ...(toolConfig.oauth?.required &&
            isOAuthServiceDeploymentAvailable(toolConfig.oauth.provider) && {
              oauth: {
                required: true,
                provider: toolConfig.oauth.provider,
              },
            }),
        })
      } catch (toolError) {
        if (toolError instanceof EnvCapabilityConfigurationError) throw toolError
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
    if (error instanceof EnvCapabilityConfigurationError) throw error
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
): Promise<ChatRequest> {
  const { message, workflowId, userId, userMessageId, mode, contexts, fileAttachments, chatId } =
    params

  const effectiveMode = mode === 'agent' ? 'build' : mode
  const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

  // Track uploaded files in the DB and build context tags instead of base64 inlining.
  // Tracking writes `workspace_files` rows, so it needs the same write grant the
  // upload routes that issue these keys already require — reaching the chat
  // endpoint with `read` must not confer a file-write capability.
  const uploadContexts: Array<{ type: string; content: string; tag?: string; path?: string }> = []
  // `userPermission` is typed `string` for legacy reasons, so narrow it before
  // comparing — an unrecognized value must fail the gate, not rank below it.
  const canWriteWorkspaceFiles =
    isPermissionType(params.userPermission) && permissionSatisfies(params.userPermission, 'write')
  if (chatId && params.workspaceId && fileAttachments && fileAttachments.length > 0) {
    if (!canWriteWorkspaceFiles) {
      logger.warn('Dropping chat file attachments without workspace write access', {
        chatId,
        workspaceId: params.workspaceId,
        attachmentCount: fileAttachments.length,
      })
    }
    const trackableAttachments = canWriteWorkspaceFiles ? fileAttachments : []
    for (const f of trackableAttachments) {
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
        // files/ and `files ls uploads` output); the resolver also accepts the raw
        // display name.
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
            `File "${displayName}" (${mediaType}, ${f.size} bytes) uploaded to this chat as "uploads/${encodedUploadName}" (a chat upload: readable here, not listed under workspace files/).`,
            `Read it with: sim --output json files read "uploads/${encodedUploadName}"`,
            `Pass the same path "uploads/${encodedUploadName}" as inputs.files[].path to mount it in run_code or use it as a reference image in generate_image.`,
          ]
          if (displayName.endsWith('.json')) {
            lines.push(
              `If it is a workflow export: read it with files read, then import the JSON with: sim --output json workflows import --workflow '<the JSON>'`
            )
          }
        }
        uploadContexts.push({
          type: 'uploaded_file',
          content: lines.join('\n'),
        })
      } catch (err) {
        const cause = toError(err)
        logger.warn('Failed to track chat upload', {
          filename,
          chatId,
          error: cause.message,
        })
        // Isolate failures by entry. Aborting here discarded every valid
        // sibling attachment in the request, even ones already tracked. Give
        // the model a local marker for this file and continue preparing the
        // rest of the batch.
        uploadContexts.push({
          type: 'uploaded_file',
          content: `File "${filename}" could not be prepared for Copilot and was omitted. Other attached files remain available.`,
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

  // The wire payload IS the shared contract (ChatRequest in lib/mothership/generated/
  // protocol.ts) — nothing else. Model/provider/mode are server-decided (P12); permissions
  // are enforced by v2 under the delegation token, not asserted here; desktop capabilities
  // are out of scope for v1. The params above still carry sim-internal knowledge (mode
  // gates which tool schemas get built), but none of it rides the wire.
  return {
    message,
    userId,
    messageId: userMessageId,
    ...(chatId ? { chatId } : {}),
    workspaceId: params.workspaceId,
    ...(workflowId ? { workflowId } : {}),
    ...(allContexts.length > 0 ? { context: allContexts } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(mothershipTools.length > 0 ? { mothershipTools } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    ...(params.effort ? { effort: params.effort } : {}),
    // The mounted chat view executes client-routed workflow tools (run panel UX), so the
    // UI declares that capability explicitly; headless callers omit or send [] and the
    // server runs those tools immediately instead of waiting out the pickup grace.
    clientCapabilities: ['workflow-tool-pickup'],
  }
}
