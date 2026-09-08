import type { BrowserKnownSession } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { isPermissionType, permissionSatisfies } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import {
  isAssistantIntegrationParameter,
  isAssistantIntegrationTool,
} from '@/lib/copilot/assistant/tool-policy'
import { getBlockVisibilityForCopilot, visibilitySignature } from '@/lib/copilot/block-visibility'
import type { VfsSnapshotV1 } from '@/lib/copilot/generated/vfs-snapshot-v1'
import {
  type IntegrationGateConfig,
  integrationGateSignature,
  projectIntegrationToolsForViewer,
} from '@/lib/copilot/integration-tool-projection'
import { buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'
import { getToolEntry } from '@/lib/copilot/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { isDocSandboxEnabled, isHosted } from '@/lib/core/config/env-flags'
import { isOAuthServiceDeploymentAvailable } from '@/lib/integrations/availability.server'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { buildArchiveExtractGuidance, isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import { deriveHostedApiKeySupport } from '@/tools/hosted-api-key'
import { getToolMetadata } from '@/tools/metadata'

const logger = createLogger('CopilotChatPayload')
const INTEGRATION_TOOL_SCHEMA_CACHE_TTL_MS = 5_000
const INTEGRATION_TOOL_SCHEMA_CACHE_MAX_ENTRIES = 500
const INTEGRATION_TOOL_SCHEMA_CACHE_MAX_BYTES = 32 * 1024 * 1024

interface BuildPayloadParams {
  message: string
  workflowId?: string
  workflowName?: string
  workspaceId?: string
  organizationId?: string
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
  assistantSearch?: WorkspaceSearchFilters
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
  personalAccountsOnly?: boolean
}

interface IntegrationToolSchemaBuildContext {
  userId: string
  options: Required<BuildIntegrationToolSchemasOptions>
  vis: BlockVisibilityState | null
  permissionConfig: IntegrationGateConfig | null
}

const integrationToolSchemaCache = new LRUCache<
  string,
  ToolSchema[],
  IntegrationToolSchemaBuildContext
>({
  max: INTEGRATION_TOOL_SCHEMA_CACHE_MAX_ENTRIES,
  maxSize: INTEGRATION_TOOL_SCHEMA_CACHE_MAX_BYTES,
  sizeCalculation: (schemas) => Buffer.byteLength(JSON.stringify(schemas)),
  ttl: INTEGRATION_TOOL_SCHEMA_CACHE_TTL_MS,
  ignoreFetchAbort: true,
  fetchMethod: async (_key, _staleValue, { context }) =>
    buildIntegrationToolSchemasUncached(context),
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
  options: BuildIntegrationToolSchemasOptions = { schemaSurface: 'copilot' },
  workspaceId?: string
): Promise<ToolSchema[]> {
  const schemaSurface = options.schemaSurface ?? 'copilot'
  const personalAccountsOnly = options.personalAccountsOnly ?? false
  const vis = await getBlockVisibilityForCopilot(userId, workspaceId)
  // Resolved before the key, not inside the cached build, so the entry is keyed
  // to the policy it was produced under. The read this adds is cheap next to
  // what the entry caches: a user-tool schema per exposed integration tool.
  let permissionConfig: IntegrationGateConfig | null = null
  if (workspaceId) {
    const { resolvePermissionGroupConfig } = await import(
      '@/lib/permission-groups/config-scope.server'
    )
    permissionConfig = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  }
  const cacheKey = getIntegrationToolSchemaCacheKey(
    userId,
    workspaceId,
    personalAccountsOnly ? `${schemaSurface}:personal` : schemaSurface,
    visibilitySignature(vis),
    integrationGateSignature(permissionConfig)
  )
  const schemas = await integrationToolSchemaCache.fetch(cacheKey, {
    context: { userId, options: { schemaSurface, personalAccountsOnly }, vis, permissionConfig },
  })
  if (!schemas) throw new Error('Integration tool catalog is unavailable')
  return structuredClone(schemas)
}

async function buildIntegrationToolSchemasUncached({
  userId,
  options,
  vis,
  permissionConfig,
}: IntegrationToolSchemaBuildContext): Promise<ToolSchema[]> {
  const integrationTools: ToolSchema[] = []
  const { createUserToolSchema } = await import('@/tools/params')
  const subscription = await getHighestPrioritySubscription(userId)
  const shouldAppendEmailTagline = !subscription || !isPaid(subscription.plan)

  const { tools: exposedTools } = projectIntegrationToolsForViewer(vis, permissionConfig)
  for (const { toolId, config: toolConfig, service, operation } of exposedTools) {
    const metadata = getToolMetadata(toolId)
    if (options.personalAccountsOnly && !isAssistantIntegrationTool(metadata)) continue
    const userSchema = createUserToolSchema(toolConfig, {
      surface: options.schemaSurface,
      // On hosted deployments the executor injects hosted keys server-side,
      // so the gateway schema must not force the model to supply one (the
      // model never sees the key either way).
      hostedKeySupport: isHosted,
    })
    if (options.personalAccountsOnly && metadata) {
      for (const name of Object.keys(userSchema.properties ?? {})) {
        if (!isAssistantIntegrationParameter(metadata, name)) {
          delete userSchema.properties?.[name]
          userSchema.required = userSchema.required?.filter((key: string) => key !== name)
        }
      }
      if (metadata.personalToken) {
        userSchema.properties ??= {}
        userSchema.properties.credentialId = {
          type: 'string',
          description:
            'ID of your connected personal account. Its token and GitLab host are supplied securely.',
        }
        userSchema.required = [...new Set([...(userSchema.required ?? []), 'credentialId'])]
      }
    }
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
            .map(([key, output]) => [key, { type: output.type, description: output.description }])
        ),
      }),
      defer_loading: true,
      executeLocally: catalogEntry?.clientExecutable === true || catalogEntry?.route === 'client',
      ...(toolConfig.oauth?.required &&
        isOAuthServiceDeploymentAvailable(toolConfig.oauth.provider) && {
          oauth: {
            required: true,
            provider: toolConfig.oauth.provider,
          },
        }),
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
  const isAssistant = effectiveMode === 'assistant'

  // Track uploaded files in the DB and build context tags instead of base64 inlining.
  // Tracking writes `workspace_files` rows, so it needs the same write grant the
  // upload routes that issue these keys already require — reaching the chat
  // endpoint with `read` must not confer a file-write capability.
  const uploadContexts: Array<{ type: string; content: string; tag?: string; path?: string }> = []
  // `userPermission` is typed `string` for legacy reasons, so narrow it before
  // comparing — an unrecognized value must fail the gate, not rank below it.
  const canWriteWorkspaceFiles =
    isPermissionType(params.userPermission) && permissionSatisfies(params.userPermission, 'write')
  if (
    !isAssistant &&
    chatId &&
    params.workspaceId &&
    fileAttachments &&
    fileAttachments.length > 0
  ) {
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
        // files/ and the uploads glob output). The save_upload `fileName`
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
            `To save permanently: save_upload(fileName: "${displayName}")`,
          ]
          if (displayName.endsWith('.json')) {
            lines.push(
              `To import as a workflow: save_upload(fileName: "${displayName}", operation: "import")`
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

  const allContexts = isAssistant ? [] : [...(contexts ?? []), ...uploadContexts]

  let integrationTools: ToolSchema[] = []
  let mothershipTools: ToolSchema[] = []

  if (!params.organizationId && (effectiveMode === 'build' || isAssistant)) {
    integrationTools = await buildIntegrationToolSchemas(
      userId,
      { schemaSurface: 'copilot', personalAccountsOnly: isAssistant },
      params.workspaceId
    )
  }

  if (!isAssistant && params.workspaceId && params.mcpServerIds?.length) {
    mothershipTools = await buildTaggedMcpToolSchemas(
      userId,
      params.workspaceId,
      params.mcpServerIds
    )
  }

  return {
    message,
    ...(!isAssistant && workflowId ? { workflowId } : {}),
    ...(!isAssistant && params.workflowName ? { workflowName: params.workflowName } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    userId,
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(provider ? { provider } : {}),
    mode: transportMode,
    ...(isAssistant && params.assistantSearch ? { assistantSearch: params.assistantSearch } : {}),
    messageId: userMessageId,
    ...(allContexts.length > 0 ? { context: allContexts } : {}),
    ...(chatId ? { chatId } : {}),
    ...(typeof prefetch === 'boolean' ? { prefetch } : {}),
    ...(implicitFeedback ? { implicitFeedback } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(mothershipTools.length > 0 ? { mothershipTools } : {}),
    ...(!isAssistant && commands && commands.length > 0 ? { commands } : {}),
    ...(params.workspaceContext ? { workspaceContext: params.workspaceContext } : {}),
    ...(!isAssistant && params.vfs ? { vfs: params.vfs } : {}),
    ...(params.userPermission ? { userPermission: params.userPermission } : {}),
    ...(!isAssistant && params.entitlements?.length ? { entitlements: params.entitlements } : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    ...(params.userMetadata &&
    (params.userMetadata.name || params.userMetadata.email || params.userMetadata.timezone)
      ? { userMetadata: params.userMetadata }
      : {}),
    // Tell the copilot file subagent which document toolchain to write. Emitted
    // only in Python mode so the JS path sends no new field (Go defaults to js).
    ...(isDocSandboxEnabled ? { docCompiler: 'python' } : {}),
    ...(!params.organizationId &&
    ((!isAssistant && params.desktopLocalFilesystem) || params.browser || params.terminalCapable)
      ? {
          desktopCapabilities: {
            ...(!isAssistant && params.desktopLocalFilesystem ? { localFilesystem: true } : {}),
            ...(params.browser ? { browser: true } : {}),
            ...(params.terminalCapable ? { terminal: true } : {}),
            ...(params.terminalCapable && params.terminals?.length
              ? { terminals: params.terminals }
              : {}),
            ...(params.browser && params.browserSessions?.length
              ? { browserSessions: params.browserSessions }
              : {}),
          },
        }
      : {}),
    isHosted,
  }
}
