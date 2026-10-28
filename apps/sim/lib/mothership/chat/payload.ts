import type { Principal } from '@sim/auth/principal'
import type { BrowserKnownSession } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { isPermissionType, permissionSatisfies } from '@sim/platform-authz/predicates'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { isPaid } from '@/lib/billing/plan-helpers'
import { isComputerUseAvailableFor } from '@/lib/computer-use/application/availability'
import { isHosted } from '@/lib/core/config/env-flags'
import { yieldWhenSliceExpires } from '@/lib/core/utils/event-loop'
import { isOAuthServiceDeploymentAvailable } from '@/lib/integrations/availability.server'
import { getExposedIntegrationTools } from '@/lib/integrations/tool-catalog'
import {
  type IntegrationGateConfig,
  projectIntegrationToolsForViewer,
} from '@/lib/integrations/tool-projection'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { executeOrganizationSecretUseCase } from '@/lib/mothership/application/execute-organization-secret-use-case'
import { projectAssistantConnectedAccountTool } from '@/lib/mothership/assistant/connected-account-tool'
import {
  isAssistantIntegrationParameter,
  isAssistantIntegrationTool,
} from '@/lib/mothership/assistant/tool-policy'
import { getBlockVisibilityForCopilot } from '@/lib/mothership/block-visibility'
import type { AssistantImageContent } from '@/lib/mothership/chat/assistant-images'
import { buildUploadedFileContext } from '@/lib/mothership/chat/upload-context'
import { buildWorkspaceInventory } from '@/lib/mothership/chat/workspace-inventory'
import { computeEntitlements } from '@/lib/mothership/entitlements'
import { isSearchIntegrationToolsEnabled } from '@/lib/mothership/feature-flags'
import type { AssistantSearchLevel } from '@/lib/mothership/generated/assistant'
import {
  type ChatRequest,
  type ModelSelection,
  TOOL_DEADLINE_CAPABILITY,
} from '@/lib/mothership/generated/protocol'
import type { VfsSnapshotV1 } from '@/lib/mothership/generated/vfs-snapshot-v1'
import { getToolEntry } from '@/lib/mothership/tool-executor/router'
import { getCopilotToolDescription } from '@/lib/mothership/tools/descriptions'
import { providerIdsForService } from '@/lib/oauth/utils'
import { listOrganizationSecretNames } from '@/lib/organization-secrets/application/use-cases'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { trackChatUpload } from '@/lib/uploads/contexts/workspace/file-manager'
import { deriveHostedApiKeySupport } from '@/tools/hosted-api-key'
import { getToolMetadata } from '@/tools/metadata'

const logger = createLogger('CopilotChatPayload')
const EMAIL_TAGLINE_CACHE_TTL_MS = 5_000
const EMAIL_TAGLINE_CACHE_MAX_ENTRIES = 20_000
/** One per schema surface and personal-accounts mode; the cap only backstops a new surface. */
const INTEGRATION_TOOL_SCHEMA_VARIANT_MAX_ENTRIES = 8

interface BuildPayloadParams {
  message: string
  workflowId?: string
  workflowName?: string
  workspaceId?: string
  organizationId?: string
  userId: string
  /** The caller's principal — lets the request carry a workspace inventory read under the caller's own authorization. */
  principal?: Principal
  userMessageId: string
  mode: string
  model: string
  provider?: string
  contexts?: Array<{ type: string; content: string; tag?: string; path?: string }>
  /**
   * MCP servers tagged on this or any earlier turn of the chat. Every usable
   * workspace server is discoverable without a tag; tagged ones rank first.
   */
  mcpServerIds?: string[]
  fileAttachments?: Array<{ id: string; key: string; size: number; [key: string]: unknown }>
  assistantImages?: AssistantImageContent[]
  commands?: string[]
  chatId?: string
  prefetch?: boolean
  implicitFeedback?: string
  assistantSearchLevel?: AssistantSearchLevel
  assistantFast?: boolean
  assistantSearch?: WorkspaceSearchFilters
  workspaceContext?: string
  vfs?: VfsSnapshotV1
  userPermission?: string
  /** Plan/flag-gated org capabilities (e.g. "custom-blocks") the mothership gates tools/prompts on. */
  userTimezone?: string
  /** Per-turn model effort dial (user-selected in the composer). */
  effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  modelSelection?: ModelSelection
  desktopLocalFiles?: boolean
  desktopLocalFilesystem?: boolean
  browser?: boolean
  terminalCapable?: boolean
  computerUse?: boolean
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
  organizationId?: string
}

type IntegrationToolSchemaVariantOptions = Required<
  Omit<BuildIntegrationToolSchemasOptions, 'organizationId'>
>

/**
 * Every exposed integration tool's schema for one surface and mode, by tool id.
 *
 * Depends only on the tool registry and deployment config (`isHosted`, OAuth availability),
 * fixed for the process's life, never on the viewer, so it is built once per process and
 * shared: the entries are frozen and must not be mutated.
 * Viewer gating (block visibility, permission groups, the deployment allowlist) picks
 * which entries a request returns. Tools whose description gains the free-plan email
 * tagline also get a tagged copy in `withEmailTagline`, sharing the same input schema.
 */
interface IntegrationToolSchemaVariant {
  schemas: ReadonlyMap<string, ToolSchema>
  withEmailTagline: ReadonlyMap<string, ToolSchema>
}

const integrationToolSchemaVariants = new LRUCache<
  string,
  IntegrationToolSchemaVariant,
  IntegrationToolSchemaVariantOptions
>({
  max: INTEGRATION_TOOL_SCHEMA_VARIANT_MAX_ENTRIES,
  ignoreFetchAbort: true,
  fetchMethod: async (_key, _staleValue, { context }) => buildIntegrationToolSchemaVariant(context),
})

/** Whether the viewer's plan adds the email tagline; as fresh as the subscription read it caches. */
const emailTaglineCache = new LRUCache<string, boolean>({
  max: EMAIL_TAGLINE_CACHE_MAX_ENTRIES,
  ttl: EMAIL_TAGLINE_CACHE_TTL_MS,
  ignoreFetchAbort: true,
  fetchMethod: async (userId) => {
    const subscription = await getHighestPrioritySubscription(userId)
    return !subscription || !isPaid(subscription.plan)
  },
})

export function clearIntegrationToolSchemaCacheForTests(): void {
  integrationToolSchemaVariants.clear()
  emailTaglineCache.clear()
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  Object.freeze(value)
  return value
}

/**
 * Build deferred integration tool schemas from the Sim tool registry.
 * The on-demand catalog uses this canonical projection; schemas never ride
 * the initial chat request or its recovery configuration.
 *
 * When `workspaceId` is provided the user's workspace permission config is
 * loaded once and used to skip any tool whose owning block is not in the
 * workspace's `allowedIntegrations` allowlist.
 *
 * The returned array is the caller's own, but its schemas are shared across
 * requests and frozen: copy one before changing it.
 */
export async function buildIntegrationToolSchemas(
  userId: string,
  options: BuildIntegrationToolSchemasOptions = { schemaSurface: 'copilot' },
  workspaceId?: string
): Promise<ToolSchema[]> {
  const schemaSurface = options.schemaSurface ?? 'copilot'
  const personalAccountsOnly = options.personalAccountsOnly ?? false
  const vis = await getBlockVisibilityForCopilot(userId, workspaceId, options.organizationId)
  let permissionConfig: IntegrationGateConfig | null = null
  if (workspaceId) {
    const { resolvePermissionGroupConfig } = await import(
      '@/lib/permission-groups/config-scope.server'
    )
    permissionConfig = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  } else if (options.organizationId) {
    const organizationConfig = await getUserPermissionConfigForOrganization(options.organizationId)
    if (personalAccountsOnly && capabilityDeniedBy('integrations.manage', organizationConfig))
      return []
    permissionConfig = organizationConfig
  }
  const [variant, appendEmailTagline] = await Promise.all([
    integrationToolSchemaVariants.fetch(JSON.stringify([schemaSurface, personalAccountsOnly]), {
      context: { schemaSurface, personalAccountsOnly },
    }),
    emailTaglineCache.fetch(userId),
  ])
  if (!variant || appendEmailTagline === undefined)
    throw new Error('Integration tool catalog is unavailable')

  const schemas: ToolSchema[] = []
  for (const { toolId, service } of projectIntegrationToolsForViewer(vis, permissionConfig).tools) {
    const schema =
      (appendEmailTagline ? variant.withEmailTagline.get(toolId) : undefined) ??
      variant.schemas.get(toolId)
    if (!schema) continue
    // The viewer's visible owning block can be a different service than the canonical one.
    schemas.push(schema.service === service ? schema : Object.freeze({ ...schema, service }))
  }

  if (options.organizationId && personalAccountsOnly) {
    const approvals = await listOrganizationSearchApprovals(options.organizationId)
    const providers = new Set(
      SEARCH_CONNECTORS.filter((connector) => approvals.get(connector.type) === true).map(
        (connector) => connector.providerId
      )
    )
    return schemas.filter((schema) => {
      const original = getToolMetadata(schema.name)
      const metadata = original ? projectAssistantConnectedAccountTool(original) : undefined
      return (
        !metadata?.personalToken &&
        metadata?.oauth?.required &&
        providerIdsForService(metadata.oauth.provider).some((providerId) =>
          providers.has(providerId)
        )
      )
    })
  }
  return schemas
}

async function buildIntegrationToolSchemaVariant(
  options: IntegrationToolSchemaVariantOptions
): Promise<IntegrationToolSchemaVariant> {
  const schemas = new Map<string, ToolSchema>()
  const withEmailTagline = new Map<string, ToolSchema>()
  const { createUserToolSchema } = await import('@/tools/params')

  for (const { toolId, config: toolConfig, service, operation } of getExposedIntegrationTools()) {
    await yieldWhenSliceExpires()
    const metadata = getToolMetadata(toolId)
    if (options.personalAccountsOnly && !isAssistantIntegrationTool(metadata)) continue
    const projectedTool = options.personalAccountsOnly
      ? projectAssistantConnectedAccountTool(toolConfig)
      : toolConfig
    const userSchema = createUserToolSchema(projectedTool, {
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
    const describe = (appendEmailTagline: boolean) =>
      getCopilotToolDescription(toolConfig, {
        isHosted,
        hostedApiKey: deriveHostedApiKeySupport(toolConfig.hosting),
        fallbackName: toolId,
        appendEmailTagline,
      })
    const description = describe(false)
    // Cloned so freezing the shared schema never freezes registry objects it was built from.
    const schema = deepFreeze(
      structuredClone<ToolSchema>({
        name: toolId,
        service,
        operation,
        description,
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
        ...(projectedTool.oauth?.required &&
          isOAuthServiceDeploymentAvailable(projectedTool.oauth.provider) && {
            oauth: {
              required: true,
              provider: projectedTool.oauth.provider,
            },
          }),
      })
    )
    schemas.set(toolId, schema)
    const taggedDescription = describe(true)
    if (taggedDescription !== description)
      withEmailTagline.set(toolId, Object.freeze({ ...schema, description: taggedDescription }))
  }

  return { schemas, withEmailTagline }
}

/**
 * Build the request payload for the copilot backend.
 */
export async function buildCopilotRequestPayload(params: BuildPayloadParams): Promise<ChatRequest> {
  const { message, workflowId, userId, userMessageId, mode, contexts, fileAttachments, chatId } =
    params
  const effectiveMode = mode === 'agent' ? 'build' : mode
  const isAssistant = effectiveMode === 'assistant'
  const computerUseOwner = params.organizationId
    ? { organizationId: params.organizationId }
    : params.workspaceId
      ? { workspaceId: params.workspaceId }
      : null
  const computerUse =
    !isAssistant &&
    params.computerUse === true &&
    params.principal !== undefined &&
    computerUseOwner !== null &&
    (await isComputerUseAvailableFor(params.principal, computerUseOwner))
  const integrationGateway = !isAssistant || (await isSearchIntegrationToolsEnabled())

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
        uploadContexts.push(buildUploadedFileContext(displayName, mediaType, f.size))
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

  if (params.organizationId && !isAssistant) {
    for (const attachment of params.fileAttachments ?? []) {
      uploadContexts.push(
        buildUploadedFileContext(
          typeof attachment.filename === 'string' ? attachment.filename : attachment.id,
          typeof attachment.media_type === 'string'
            ? attachment.media_type
            : 'application/octet-stream',
          attachment.size,
          attachment.id
        )
      )
    }
  }

  const allContexts = isAssistant
    ? params.workspaceContext
      ? [
          {
            type: params.organizationId ? 'search_integrations' : 'connected_accounts',
            content: params.workspaceContext,
          },
        ]
      : []
    : [
        ...(contexts ?? []),
        ...uploadContexts,
        ...(params.organizationId && params.workspaceContext
          ? [{ type: 'search_integrations', content: params.workspaceContext }]
          : []),
      ]

  if ((effectiveMode === 'build' || effectiveMode === 'plan') && params.organizationId && chatId) {
    const { names } = await executeOrganizationSecretUseCase(
      {
        userId,
        organizationId: params.organizationId,
        chatId,
        toolCallId: userMessageId,
        copilotToolExecution: true,
        requestMode: effectiveMode === 'plan' ? 'plan' : 'agent',
      },
      listOrganizationSecretNames,
      {}
    )
    if (names.length)
      allContexts.push({
        type: 'generic_secrets',
        content: JSON.stringify({
          names,
          usage:
            'Mount only needed names with the secrets argument of run_code or run_function. Read values from environment variables for curl or code. Generic Secrets are available in Build and Plan. In organization chats these names take precedence over same-named workspace secrets.',
        }),
      })
  }

  /** Assistant sends its trusted mode and prepared context; Build may include authorized workspace inventory. */
  const inventory =
    !isAssistant && params.principal && params.workspaceId
      ? await buildWorkspaceInventory(params.principal, params.workspaceId)
      : undefined
  const entitlements = isAssistant
    ? []
    : await computeEntitlements({
        principal: params.principal,
        workspaceId: params.workspaceId,
        organizationId: params.organizationId,
      })
  return {
    entitlements,
    message,
    ...(!isAssistant && workflowId ? { workflowId } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    userId,
    mode: isAssistant ? 'assistant' : mode === 'plan' ? 'plan' : 'agent',
    ...(isAssistant && params.assistantSearchLevel !== undefined
      ? { assistantSearchLevel: params.assistantSearchLevel }
      : {}),
    ...(isAssistant && params.assistantFast !== undefined
      ? { assistantFast: params.assistantFast }
      : {}),
    ...((isAssistant || params.organizationId) && params.assistantSearch
      ? { assistantSearch: params.assistantSearch }
      : {}),
    ...(params.organizationId && params.assistantImages?.length
      ? { assistantImages: params.assistantImages }
      : {}),
    messageId: userMessageId,
    ...(chatId ? { chatId } : {}),
    ...(allContexts.length > 0 ? { context: allContexts } : {}),
    ...(integrationGateway
      ? {
          integrationCatalog: {
            mcpServerIds: isAssistant ? [] : [...new Set(params.mcpServerIds ?? [])],
          },
        }
      : {}),
    ...(params.userTimezone ? { userTimezone: params.userTimezone } : {}),
    ...(params.effort ? { effort: params.effort } : {}),
    ...(params.modelSelection ? { modelSelection: params.modelSelection } : {}),
    ...(inventory ? { inventory } : {}),
    ...(!isAssistant &&
    (params.desktopLocalFiles || params.browser || params.terminalCapable || computerUse)
      ? {
          desktop: {
            ...(params.desktopLocalFiles ? { localFiles: true } : {}),
            browser: params.browser === true,
            terminal: params.terminalCapable === true,
            computerUse,
            terminals: params.terminalCapable ? (params.terminals ?? []).slice(0, 20) : [],
            browserSessions: params.browser ? (params.browserSessions ?? []).slice(0, 20) : [],
          },
        }
      : {}),
    // The mounted chat view executes client-routed workflow tools (run panel UX), so the
    // UI declares that capability explicitly; headless callers omit it and the server runs
    // those tools immediately. The deadline token is this server's own: it bounds every
    // handed call by the deadline its frame names.
    clientCapabilities: [
      ...(isAssistant ? [] : ['workflow-tool-pickup']),
      TOOL_DEADLINE_CAPABILITY,
    ],
  }
}
