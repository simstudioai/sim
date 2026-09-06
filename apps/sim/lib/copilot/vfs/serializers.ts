import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import type { Sandbox } from '@/lib/api/contracts/sandboxes'
import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  getServiceAccountConnectNoun,
  getServiceAccountGatingBlockType,
} from '@/lib/credentials/service-account-provider-ids'
import {
  MAX_SANDBOX_CLI_TOOLS,
  SANDBOX_CLI_TOOLS,
  SANDBOX_SELECTABLE_CLI_TOOL_IDS,
} from '@/lib/execution/remote-sandbox/cli-tools'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { getServiceAccountProviderForProviderId } from '@/lib/oauth/utils'
import { type IsToolAllowed, OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
import { isRetryEligibleBlock } from '@/lib/workflows/blocks/retry-eligibility'
import { isSubBlockHidden } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks'
import { isCustomBlockType } from '@/blocks/custom/build-config'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { isHiddenUnder } from '@/blocks/visibility/context'
import {
  DYNAMIC_MODEL_PROVIDERS,
  PROVIDER_DEFINITIONS,
  SIM_AUTO_MODEL_ID,
} from '@/providers/models'
import { deriveHostedApiKeySupport } from '@/tools/hosted-api-key'
import type { ExecutableToolConfig, ToolHostingCondition } from '@/tools/types'
import { buildSlackManifest, SLACK_CAPABILITIES } from '@/triggers/slack/capabilities'
import { buildSlackCustomBotRequestUrl } from '@/triggers/webhook-url'

/** The service-account alternative to OAuth for a service, when it offers one. */
export interface VfsServiceAccountAuth {
  /** Vendor noun for the secret it collects — "private app token", "server-to-server app", … */
  connectNoun: string
}

export type VfsToolAuth =
  | {
      type: 'oauth'
      required: boolean
      provider: string
      /**
       * Present when this OAuth service also accepts a shared service-account
       * credential (connect AS AN APPLICATION, not as the user). The agent emits
       * a `service_account` credential tag with this entry's OAuth `provider` to
       * open the in-chat setup form. Omitted when the service has no
       * service-account flow or its owning block is hidden.
       */
      serviceAccount?: VfsServiceAccountAuth
    }
  | {
      type: 'api_key'
      param: string
      mode: 'hosted_or_byok' | 'conditional_hosted_or_byok' | 'byok_required'
      provider?: string
      condition?: ToolHostingCondition
    }

/**
 * Whether an OAuth provider value also exposes a service-account flow, and the
 * noun for the secret it collects. The single composition point behind both the
 * per-tool `auth.serviceAccount` field and the `oauth-integrations.json`
 * roll-up, so the two never disagree. Returns `undefined` when the service has
 * no service-account flow, or its owning block is hidden and is not the owner
 * currently being serialized.
 */
export function describeServiceAccountForOAuthProvider(
  oauthProvider: string,
  ownerBlockType?: string
): VfsServiceAccountAuth | undefined {
  const serviceAccountProviderId = getServiceAccountProviderForProviderId(oauthProvider)
  if (!serviceAccountProviderId) return undefined
  const gatingBlockType = getServiceAccountGatingBlockType(serviceAccountProviderId)
  if (gatingBlockType) {
    const gatingBlock = getBlock(gatingBlockType)
    if (!gatingBlock || (ownerBlockType !== gatingBlockType && isHiddenUnder(null, gatingBlock))) {
      return undefined
    }
  }
  return { connectNoun: getServiceAccountConnectNoun(serviceAccountProviderId) }
}

export interface ComponentSerializationOptions {
  hosted?: boolean
  toolConfigs?: ReadonlyMap<string, ExecutableToolConfig>
  ownerBlockType?: string
  /** Product-gated inputs removed from both subBlocks and the input schema. */
  hiddenInputIds?: ReadonlySet<string>
  /** Product-gated inputs that remain discoverable but cannot be mutated by this viewer. */
  restrictedInputs?: ReadonlyMap<
    string,
    {
      requiredEntitlement: string
      reason: string
    }
  >
  /**
   * The viewer's permission-group tool gate. Denied tool ids are dropped from
   * `tools` and `toolAuth` so the agent is never handed an id it may not call.
   */
  isToolAllowed?: IsToolAllowed
  /**
   * Operation ids the viewer's permission group denies, removed from the
   * operation selector's options. Paired with `isToolAllowed` rather than
   * derived here so the caller — which also decides whether a wholly denied
   * block is worth publishing at all — resolves them exactly once.
   */
  deniedOperationIds?: ReadonlySet<string>
}

/**
 * Project runtime tool authentication into a stable, machine-readable VFS contract.
 * ToolConfig.hosting remains the source of truth for every hosted-key integration.
 */
export function serializeToolAuth(
  tool: ExecutableToolConfig,
  hosted = isHosted,
  ownerBlockType?: string
): VfsToolAuth | undefined {
  if (tool.oauth) {
    const serviceAccount = describeServiceAccountForOAuthProvider(
      tool.oauth.provider,
      ownerBlockType
    )
    return {
      type: 'oauth',
      required: tool.oauth.required,
      provider: tool.oauth.provider,
      ...(serviceAccount ? { serviceAccount } : {}),
    }
  }

  if (!tool.hosting) return undefined

  return {
    type: 'api_key',
    param: tool.hosting.apiKeyParam,
    mode: hosted
      ? tool.hosting.enabled
        ? 'conditional_hosted_or_byok'
        : 'hosted_or_byok'
      : 'byok_required',
    provider: tool.hosting.byokProviderId,
    condition: hosted ? tool.hosting.enabled?.condition : undefined,
  }
}

/**
 * Serialize workflow metadata for VFS meta.json.
 *
 * `locked` is the EFFECTIVE lock — true when the workflow is locked directly or
 * sits inside a locked folder. A locked workflow cannot be edited, moved,
 * renamed, or deleted (mutations are rejected server-side with a 423). The
 * mothership should read this before attempting any workflow mutation.
 * `inheritedFolderLock` carries the resolved containing-folder lock (the
 * caller computes folder inheritance; see workspace-vfs materializeWorkflows).
 */
export function serializeWorkflowMeta(
  wf: {
    id: string
    name: string
    folderId?: string | null
    isDeployed: boolean
    deployedAt?: Date | null
    runCount: number
    lastRunAt?: Date | null
    createdAt: Date
    updatedAt: Date
    locked?: boolean
  },
  options?: { inheritedFolderLock?: boolean }
): string {
  const directLock = wf.locked ?? false
  const locked = directLock || (options?.inheritedFolderLock ?? false)
  return JSON.stringify(
    {
      id: wf.id,
      name: wf.name,
      folderId: wf.folderId || undefined,
      locked,
      lockedBy: locked ? (directLock ? 'workflow' : 'folder') : undefined,
      isDeployed: wf.isDeployed,
      deployedAt: wf.deployedAt?.toISOString(),
      runCount: wf.runCount,
      lastRunAt: wf.lastRunAt?.toISOString(),
      createdAt: wf.createdAt.toISOString(),
      updatedAt: wf.updatedAt.toISOString(),
    },
    null,
    2
  )
}

/**
 * Serialize execution logs for VFS executions.json.
 * Takes recent execution log rows and produces a summary.
 */
export function serializeRecentExecutions(
  executions: Array<{
    id: string
    executionId: string
    status: string
    trigger: string
    startedAt: Date
    endedAt?: Date | null
    totalDurationMs?: number | null
  }>
): string {
  return JSON.stringify(
    executions.map((e) => ({
      executionId: e.executionId,
      status: e.status,
      trigger: e.trigger,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString(),
      durationMs: e.totalDurationMs,
    })),
    null,
    2
  )
}

/**
 * A knowledge base tag definition, reduced to the fields the agent needs to bind a tag filter.
 *
 * @remarks
 * `tagName` is the DB's `displayName`. It is renamed at this boundary because that is the key
 * a `tagFilters` entry must carry -- an entry written with `displayName` validates and persists
 * but never filters anything.
 */
export interface KbTagDefinitionSummary {
  /** The tagDefinitionId that update_tag / delete_tag / update_document.tagValues require. */
  id: string
  tagName: string
  tagSlot: string
  fieldType: string
}

/**
 * Serialize knowledge base metadata for VFS meta.json.
 *
 * `tagDefinitions` exposes the KB's defined tags (`tagName` → `tagSlot`) plus the operators
 * legal for each tag's `fieldType`, so the agent can bind a knowledge-tag filter without
 * guessing a tag name it cannot otherwise see or an operator the field does not accept
 * (`between` is valid for number/date but not text/boolean).
 */
export function serializeKBMeta(kb: {
  id: string
  name: string
  description?: string | null
  embeddingModel: string
  embeddingDimension: number
  tokenCount: number
  createdAt: Date
  updatedAt: Date
  documentCount: number
  connectorTypes?: string[]
  tagDefinitions?: KbTagDefinitionSummary[]
}): string {
  return JSON.stringify(
    {
      id: kb.id,
      name: kb.name,
      description: kb.description || undefined,
      embeddingModel: kb.embeddingModel,
      embeddingDimension: kb.embeddingDimension,
      tokenCount: kb.tokenCount,
      documentCount: kb.documentCount,
      connectorTypes:
        kb.connectorTypes && kb.connectorTypes.length > 0 ? kb.connectorTypes : undefined,
      tagDefinitions:
        kb.tagDefinitions && kb.tagDefinitions.length > 0
          ? kb.tagDefinitions.map((tag) => ({
              ...tag,
              operators: getOperatorsForFieldType(tag.fieldType as FilterFieldType).map(
                (op) => op.value
              ),
            }))
          : undefined,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
    },
    null,
    2
  )
}

/**
 * Serialize documents list for VFS documents.json (metadata only, no content)
 */
export function serializeDocuments(
  docs: Array<{
    id: string
    filename: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    processingStatus: string
    enabled: boolean
    uploadedAt: Date
  }>
): string {
  return JSON.stringify(
    docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      chunkCount: d.chunkCount,
      tokenCount: d.tokenCount,
      processingStatus: d.processingStatus,
      enabled: d.enabled,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    null,
    2
  )
}

/**
 * Serialize KB connectors for VFS knowledgebases/{name}/connectors.json.
 * Shows connector type, sync status, schedule, the credential REFERENCE
 * (an opaque id — never key material; API keys stay encrypted and are never
 * serialized), and the source config (repo/branch/channels). The last two are
 * what make a connector cloneable: without them, recreating a working
 * connector on a new KB meant guessing both the credential and the channels.
 */
export function serializeConnectors(
  connectors: Array<{
    id: string
    connectorType: string
    status: string
    syncMode: string
    syncIntervalMinutes: number
    credentialId?: string | null
    sourceConfig?: unknown
    lastSyncAt: Date | null
    lastSyncError: string | null
    lastSyncDocCount: number | null
    nextSyncAt: Date | null
    consecutiveFailures: number
    createdAt: Date
  }>
): string {
  return JSON.stringify(
    connectors.map((c) => ({
      id: c.id,
      connectorType: c.connectorType,
      status: c.status,
      syncMode: c.syncMode,
      syncIntervalMinutes: c.syncIntervalMinutes,
      credentialId: c.credentialId ?? undefined,
      sourceConfig: c.sourceConfig ?? undefined,
      lastSyncAt: c.lastSyncAt?.toISOString(),
      lastSyncError: c.lastSyncError || undefined,
      lastSyncDocCount: c.lastSyncDocCount ?? undefined,
      nextSyncAt: c.nextSyncAt?.toISOString(),
      consecutiveFailures: c.consecutiveFailures,
      createdAt: c.createdAt.toISOString(),
    })),
    null,
    2
  )
}

/**
 * Connector config field shape (mirrors ConnectorConfigField from connectors/types.ts
 * but avoids importing React-dependent code into serializers).
 */
interface SerializableConfigField {
  id: string
  title: string
  type: string
  placeholder?: string
  required?: boolean
  description?: string
  options?: Array<{ label: string; id: string }>
}

interface SerializableTagDef {
  id: string
  displayName: string
  fieldType: string
}

interface SerializableConnectorConfig {
  id: string
  name: string
  description: string
  version: string
  auth: { mode: string; provider?: string; requiredScopes?: string[] }
  configFields: SerializableConfigField[]
  tagDefinitions?: SerializableTagDef[]
  supportsIncrementalSync?: boolean
}

/**
 * Serialize a single connector type's schema for VFS knowledgebases/connectors/{type}.json.
 * Contains everything the LLM needs to build a valid sourceConfig.
 */
export function serializeConnectorSchema(connector: SerializableConnectorConfig): string {
  return JSON.stringify(
    {
      id: connector.id,
      name: connector.name,
      description: connector.description,
      version: connector.version,
      auth: connector.auth,
      configFields: connector.configFields.map((f) => {
        const field: Record<string, unknown> = {
          id: f.id,
          title: f.title,
          type: f.type,
        }
        if (f.required) field.required = true
        if (f.placeholder) field.placeholder = f.placeholder
        if (f.description) field.description = f.description
        if (f.options) field.options = f.options
        return field
      }),
      tagDefinitions: connector.tagDefinitions ?? [],
      supportsIncrementalSync: connector.supportsIncrementalSync ?? false,
    },
    null,
    2
  )
}

/**
 * Generate the knowledgebases/connectors/connectors.md overview file.
 * Lists all available connector types with their OAuth providers — enough
 * for the LLM to identify the right type and credential, then read the
 * per-connector schema file for full config details.
 */
export function serializeConnectorOverview(connectors: SerializableConnectorConfig[]): string {
  const rows = connectors.map((c) => {
    const provider = c.auth.provider ?? c.auth.mode
    const scopes = c.auth.requiredScopes?.length ? c.auth.requiredScopes.join(', ') : '(none)'
    return `| ${c.id} | ${c.name} | ${provider} | ${scopes} |`
  })

  return [
    '# Available KB Connectors',
    '',
    'Use `read("knowledgebases/connectors/{type}.json")` to get the full config schema before calling `add_connector`.',
    '',
    '| Type | Name | OAuth Provider | Required Scopes |',
    '|------|------|---------------|-----------------|',
    ...rows,
    '',
    'To add a connector, the user must have an OAuth credential for that provider.',
    'Check `environment/credentials.json` for available credential IDs.',
  ].join('\n')
}

/**
 * Serialize workspace file metadata for VFS files/{path}/{name}/meta.json.
 */
export function serializeFileMeta(file: {
  id: string
  name: string
  folderId?: string | null
  folderPath?: string | null
  vfsPath?: string
  contentType: string
  size: number
  uploadedAt: Date
  updatedAt: Date
  /** Whether the file has an active public share link. */
  shared?: boolean
  /** Auth mode of the active share; only meaningful when `shared` is true. */
  shareAuthType?: ShareAuthType
  /** Public share link (`{baseUrl}/f/{token}`); only meaningful when `shared` is true. */
  shareUrl?: string
}): string {
  return JSON.stringify(
    {
      id: file.id,
      name: file.name,
      folderId: file.folderId || undefined,
      folderPath: file.folderPath || undefined,
      vfsPath: file.vfsPath,
      contentType: file.contentType,
      size: file.size,
      uploadedAt: file.uploadedAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      readContentWith: file.vfsPath ? `${file.vfsPath}/content` : undefined,
      shared: Boolean(file.shared),
      shareAuthType: file.shared ? file.shareAuthType : undefined,
      shareUrl: file.shared ? file.shareUrl : undefined,
      note: 'This is file metadata only. To read the file text/bytes, read the readContentWith path (i.e. append /content).',
    },
    null,
    2
  )
}

/**
 * Serialize table metadata for VFS tables/{name}/meta.json
 */
export function serializeTableMeta(table: {
  id: string
  name: string
  description?: string | null
  schema: unknown
  rowCount: number
  maxRows: number
  createdAt: Date | string
  updatedAt: Date | string
}): string {
  return JSON.stringify(
    {
      id: table.id,
      name: table.name,
      description: table.description || undefined,
      schema: table.schema,
      rowCount: table.rowCount,
      maxRows: table.maxRows,
      createdAt: table.createdAt instanceof Date ? table.createdAt.toISOString() : table.createdAt,
      updatedAt: table.updatedAt instanceof Date ? table.updatedAt.toISOString() : table.updatedAt,
    },
    null,
    2
  )
}

/**
 * Returns the static model list from PROVIDER_DEFINITIONS for VFS serialization.
 * Excludes dynamic providers (ollama, vllm, openrouter) whose models are user-configured.
 * Includes provider ID and whether the model is hosted by Sim (no API key required).
 */
interface StaticModelOption {
  id: string
  provider: string
  hosted: boolean
  recommended?: boolean
  speedOptimized?: boolean
  deprecated?: boolean
}

const DYNAMIC_PROVIDERS_NOTE = {
  note: 'The options array above lists Sim\'s static provider catalog. These providers also accept user-configured models that are NOT enumerated here: the user may have additional ids available at runtime (e.g. local Ollama tags). To reference one, prefix the model id with the provider slash below — for example "ollama/llama3.1:8b" instead of the bare "llama3.1:8b". The server rejects bare ids that are not in the catalog; always use the prefix for user-configured models.',
  prefixes: DYNAMIC_MODEL_PROVIDERS.map((p) => `${p}/`),
} as const

function getStaticModelOptionsForVFS(): StaticModelOption[] {
  const hostedProviders = new Set(['openai', 'anthropic', 'google'])
  const dynamicProviders = new Set<string>(DYNAMIC_MODEL_PROVIDERS)

  const models: StaticModelOption[] = []

  // Hosted-only automatic model. Deliberately not `recommended` and given no
  // prompt guidance (limited-visibility release): the build agent can write it
  // when a user explicitly asks for the auto model, but is never steered to it.
  if (isHosted) {
    models.push({
      id: SIM_AUTO_MODEL_ID,
      provider: 'sim',
      hosted: true,
    })
  }

  for (const [providerId, def] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (dynamicProviders.has(providerId)) continue
    for (const model of def.models) {
      // Retired models are hidden from the agent's menu (mirrors the user picker)
      // so it never suggests a model whose API calls fail; legacy stays available.
      if (model.sunset?.status === 'deprecated') continue
      const option: StaticModelOption = {
        id: model.id,
        provider: providerId,
        hosted: hostedProviders.has(providerId),
      }
      if (model.recommended) option.recommended = true
      if (model.speedOptimized) option.speedOptimized = true
      if (model.sunset) option.deprecated = true
      models.push(option)
    }
  }

  return models
}

/**
 * Serialize a SubBlockConfig for the VFS component schema.
 * Strips functions and UI-only fields. Includes static options arrays.
 */
function serializeSubBlock(sb: SubBlockConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: sb.id,
    type: sb.type,
  }
  if (sb.title) result.title = sb.title
  if (sb.required === true) result.required = true
  if (sb.defaultValue !== undefined) result.defaultValue = sb.defaultValue
  if (sb.mode) result.mode = sb.mode
  if (sb.multiSelect) result.multiSelect = true
  if (sb.canonicalParamId) result.canonicalParamId = sb.canonicalParamId
  if (sb.condition && typeof sb.condition !== 'function') result.condition = sb.condition
  // Copied, not aliased: these are the registry's own arrays, shared by every
  // request in the process, so publishing one puts mutable registry state a
  // single careless consumer away from corruption. The catalog projection this
  // serializer parallels copies every array it publishes for the same reason.
  if (sb.dependsOn)
    result.dependsOn = Array.isArray(sb.dependsOn) ? [...sb.dependsOn] : sb.dependsOn

  // Include static options arrays for dropdowns
  if (Array.isArray(sb.options)) {
    result.options = [...sb.options]
  }

  return result
}

/**
 * Serialize a block schema for VFS components/blocks/{type}.json
 */
export function serializeBlockSchema(
  block: BlockConfig,
  options?: ComponentSerializationOptions
): string {
  // Custom blocks bake their `workflowId`/`inputMapping` as `hidden` sub-blocks;
  // treat `hidden` as hidden for them so those never reach the agent's schema.
  const customBlock = isCustomBlockType(block.type)
  const hosted = options?.hosted ?? isHosted
  const explicitlyHidden = options?.hiddenInputIds ?? new Set<string>()
  const visibleSubBlocks = block.subBlocks.filter(
    (sb) =>
      !explicitlyHidden.has(sb.id) &&
      !sb.hideFromCopilot &&
      !isSubBlockHidden(sb, { hosted }) &&
      !(customBlock && sb.hidden)
  )
  const visibleIds = new Set(visibleSubBlocks.map((sb) => sb.id))
  const hiddenIds = new Set(
    block.subBlocks
      .filter(
        (sb) =>
          explicitlyHidden.has(sb.id) ||
          sb.hideFromCopilot ||
          isSubBlockHidden(sb, { hosted }) ||
          (customBlock && sb.hidden)
      )
      .map((sb) => sb.id)
      .filter((id) => !visibleIds.has(id))
  )

  const deniedOperationIds = options?.deniedOperationIds
  const subBlocks = visibleSubBlocks.map((sb) => {
    const serialized = serializeSubBlock(sb)
    if (
      sb.id === OPERATION_SUBBLOCK_ID &&
      deniedOperationIds?.size &&
      Array.isArray(serialized.options)
    ) {
      serialized.options = (serialized.options as Array<{ id: string }>).filter(
        (option) => !deniedOperationIds.has(option.id)
      )
    }
    const restriction = options?.restrictedInputs?.get(sb.id)
    if (restriction) {
      serialized.readOnly = true
      serialized.requiredEntitlement = restriction.requiredEntitlement
      serialized.restrictionReason = restriction.reason
    }

    if (sb.id === 'model' && sb.type === 'combobox' && typeof sb.options === 'function') {
      serialized.options = getStaticModelOptionsForVFS()
      serialized.dynamicProviders = DYNAMIC_PROVIDERS_NOTE
    }

    return serialized
  })

  const isToolAllowed = options?.isToolAllowed
  const accessibleTools = isToolAllowed
    ? block.tools.access.filter((toolId) => isToolAllowed(toolId))
    : block.tools.access

  const toolAuth: Record<string, VfsToolAuth> = {}
  for (const toolId of accessibleTools) {
    const tool = options?.toolConfigs?.get(toolId)
    if (!tool) continue
    const auth = serializeToolAuth(tool, hosted, block.type)
    if (auth) toolAuth[toolId] = auth
  }

  const visibleInputs =
    block.inputs && hiddenIds.size > 0
      ? Object.fromEntries(Object.entries(block.inputs).filter(([key]) => !hiddenIds.has(key)))
      : block.inputs
  const inputs = visibleInputs
    ? Object.fromEntries(
        Object.entries(visibleInputs).map(([key, input]) => {
          const restriction = options?.restrictedInputs?.get(key)
          return restriction
            ? [
                key,
                {
                  ...input,
                  readOnly: true,
                  requiredEntitlement: restriction.requiredEntitlement,
                  restrictionReason: restriction.reason,
                },
              ]
            : [key, input]
        })
      )
    : visibleInputs

  return JSON.stringify(
    {
      type: block.type,
      name: block.name,
      description: block.description,
      category: block.category,
      longDescription: block.longDescription || undefined,
      bestPractices: block.bestPractices || undefined,
      triggerAllowed: block.triggerAllowed || undefined,
      // Retry is block STATE (like `enabled`), not a subBlock input — set it via
      // edit_workflow's `retry` param, never through `inputs`. Emitted only when
      // eligible so the agent never proposes a policy the executor would ignore.
      retryAllowed:
        isRetryEligibleBlock({
          blockType: block.type,
          category: block.category,
          triggerMode: undefined,
        }) || undefined,
      singleInstance: block.singleInstance || undefined,
      authMode: block.authMode || undefined,
      // Custom (deploy-as-block) blocks execute via a baked `workflow_executor`
      // internally; that's implementation plumbing, not something the agent
      // configures. Hiding it keeps the block self-contained (fields in, outputs
      // out) so the agent doesn't treat it like the generic workflow block and
      // ask for a workflowId/inputMapping.
      tools: isCustomBlockType(block.type) ? [] : accessibleTools,
      toolAuth: Object.keys(toolAuth).length > 0 ? toolAuth : undefined,
      subBlocks,
      inputs,
      outputs: Object.fromEntries(
        Object.entries(block.outputs)
          .filter(([key, val]) => key !== 'visualization' && val != null)
          .map(([key, val]) => [
            key,
            typeof val === 'string'
              ? { type: val }
              : { type: val.type, description: (val as { description?: string }).description },
          ])
      ),
    },
    null,
    2
  )
}

/**
 * Serialize OAuth credentials for VFS environment/credentials.json.
 * Shows which integrations are connected — IDs, roles, and scopes, NOT tokens.
 */
export function serializeCredentials(
  accounts: Array<{
    id?: string
    providerId: string
    displayName?: string | null
    /** What a workspace secret is for, when one has been recorded. */
    description?: string | null
    role?: string | null
    scope: string | null
    /**
     * 'service_account' for a shared app credential, 'managed_oauth' for a
     * Credential Group credential the person holds through their enrollment;
     * omitted/undefined for a personal OAuth connection.
     */
    credentialType?: 'oauth' | 'service_account' | 'managed_oauth'
    createdAt: Date
  }>
): string {
  return JSON.stringify(
    accounts.map((a) => ({
      id: a.id || undefined,
      provider: a.providerId,
      displayName: a.displayName || undefined,
      description: a.description || undefined,
      role: a.role || undefined,
      scope: a.scope || undefined,
      // 'oauth' (personal connection) vs 'service_account' (shared app
      // credential) vs 'managed_oauth' (the person's own Credential Group
      // credential) — they reconnect differently, so the agent must branch on
      // this. Env-var credentials carry no type.
      type: a.credentialType,
      // Derived, not stored: the public Request URL a Slack custom-bot app
      // posts events to. One per credential; every workflow trigger that
      // selects this credential shares it. This is what the setup wizard shows
      // in Slack's Event Subscriptions step.
      ...(a.credentialType === 'service_account' &&
      a.providerId === SLACK_CUSTOM_BOT_PROVIDER_ID &&
      a.id
        ? { requestUrl: buildSlackCustomBotRequestUrl(a.id) }
        : {}),
      connectedAt: a.createdAt.toISOString(),
    })),
    null,
    2
  )
}

/**
 * Serialize API keys for VFS environment/api-keys.json.
 * Shows key names and types — NOT the actual key values.
 */
export function serializeApiKeys(
  keys: Array<{
    id: string
    name: string
    type: string
    lastUsed: Date | null
    createdAt: Date
    expiresAt: Date | null
  }>
): string {
  return JSON.stringify(
    keys.map((k) => ({
      id: k.id,
      name: k.name,
      type: k.type,
      lastUsed: k.lastUsed?.toISOString(),
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt?.toISOString(),
    })),
    null,
    2
  )
}

interface ApiKeyIntegrationTool {
  config: ExecutableToolConfig
  service: string
  operation: string
}

/**
 * Serialize API-key integration discovery with operation-level hosted status.
 * ToolConfig.hosting is the only provider registry used to build this index.
 */
export function serializeApiKeyIntegrations(
  tools: readonly ApiKeyIntegrationTool[],
  hosted = isHosted
): string {
  const services = new Map<
    string,
    {
      params: string[]
      operations: string[]
      hostedOperations: string[]
      conditionalHostedOperations: string[]
    }
  >()

  for (const { config: tool, service, operation } of tools) {
    if (!tool.hosting?.apiKeyParam) continue

    const metadata = services.get(service) ?? {
      params: [],
      operations: [],
      hostedOperations: [],
      conditionalHostedOperations: [],
    }
    if (!metadata.params.includes(tool.hosting.apiKeyParam)) {
      metadata.params.push(tool.hosting.apiKeyParam)
    }
    metadata.operations.push(operation)
    if (hosted && tool.hosting.enabled) {
      metadata.conditionalHostedOperations.push(operation)
    } else if (hosted) {
      metadata.hostedOperations.push(operation)
    }
    services.set(service, metadata)
  }

  return JSON.stringify(Object.fromEntries(services), null, 2)
}

/**
 * Serialize environment variables for VFS environment/variables.json.
 * Shows variable NAMES only — NOT values. `unredactedWorkspace` names the workspace
 * secrets whose values appear in plaintext in run output instead of `{{NAME}}`; the
 * values themselves are still never written into the VFS.
 */
export function serializeEnvironmentVariables(
  personalVarNames: string[],
  workspaceVarNames: string[],
  unredactedWorkspaceVarNames: string[] = []
): string {
  return JSON.stringify(
    {
      personal: personalVarNames,
      workspace: workspaceVarNames,
      unredactedWorkspace: unredactedWorkspaceVarNames,
    },
    null,
    2
  )
}

/** Input types for deployment serialization. */
export interface DeploymentData {
  workflowId: string
  isDeployed: boolean
  deployedAt?: Date | null
  needsRedeployment?: boolean
  api?: {
    version: number
    createdAt: Date
  } | null
  chat?: {
    id: string
    identifier: string
    title: string
    description?: string | null
    authType: string
    customizations: unknown
    isActive: boolean
    allowedEmails?: unknown
    outputConfigs?: unknown
    includeThinking?: boolean | null
    includeToolCalls?: boolean | null
  } | null
  mcp: Array<{
    serverId: string
    serverName: string
    toolId: string
    toolName: string
    parameterDescriptionOverrides?: unknown
    toolDescription?: string | null
  }>
  versions?: Array<{
    id: string
    version: number
    name: string | null
    description: string | null
    isActive: boolean
    createdAt: Date
  }>
}

/**
 * Serialize all deployment configurations for VFS deployment.json.
 * Only includes keys for active deployment types.
 */
export function serializeDeployments(data: DeploymentData): string {
  const result: Record<string, unknown> = {}

  if (data.needsRedeployment !== undefined) {
    result.needsRedeployment = data.needsRedeployment
  }

  result.api = data.isDeployed
    ? {
        isDeployed: true,
        deployedAt: data.deployedAt?.toISOString(),
        apiEndpoint: `/api/workflows/${data.workflowId}/execute`,
        ...(data.api ? { version: data.api.version } : {}),
      }
    : { isDeployed: false }

  if (data.chat) {
    // allowedEmails/outputConfigs/includeThinking/includeToolCalls are the
    // fields deploy_as_chat accepts on redeploy; exposing the current values is
    // what lets a caller change one setting without blanking the others.
    result.chat = {
      id: data.chat.id,
      identifier: data.chat.identifier,
      chatUrl: `/chat/${data.chat.identifier}`,
      title: data.chat.title,
      description: data.chat.description || undefined,
      authType: data.chat.authType,
      customizations: data.chat.customizations,
      isActive: data.chat.isActive,
      allowedEmails: data.chat.allowedEmails ?? undefined,
      outputConfigs: data.chat.outputConfigs ?? undefined,
      includeThinking: data.chat.includeThinking ?? undefined,
      includeToolCalls: data.chat.includeToolCalls ?? undefined,
    }
  }

  if (data.mcp.length > 0) {
    result.mcp = data.mcp.map((m) => ({
      serverId: m.serverId,
      serverName: m.serverName,
      toolId: m.toolId,
      toolName: m.toolName,
      toolDescription: m.toolDescription || undefined,
      // What deploy_as_mcp accepts as `parameters` on redeploy; omitting it
      // there resets the overrides, so expose the current value.
      parameterDescriptionOverrides: m.parameterDescriptionOverrides ?? undefined,
    }))
  }

  return JSON.stringify(result, null, 2)
}

/**
 * Serialize deployment version history for VFS workflows/{name}/versions.json.
 * Lists all versions without full state — use the diff_workflows tool to compare a version,
 * or load_deployment to restore one into the draft.
 */
export function serializeVersions(
  versions: Array<{
    id: string
    version: number
    name: string | null
    description: string | null
    isActive: boolean
    createdAt: Date
  }>
): string {
  return JSON.stringify(
    versions.map((v) => ({
      id: v.id,
      version: v.version,
      name: v.name || undefined,
      description: v.description || undefined,
      isActive: v.isActive,
      createdAt: v.createdAt.toISOString(),
    })),
    null,
    2
  )
}

/**
 * Serialize a custom tool for VFS custom-tools/{name}.json
 */
export function serializeCustomTool(tool: {
  id: string
  title: string
  schema: unknown
  code: string
}): string {
  return JSON.stringify(
    {
      id: tool.id,
      title: tool.title,
      schema: tool.schema,
      code: tool.code,
    },
    null,
    2
  )
}

/**
 * Serialize an MCP server for VFS agent/mcp-servers/{name}.json
 */
export function serializeMcpServer(server: {
  id: string
  name: string
  url: string | null
  transport: string | null
  enabled: boolean
  connectionStatus: string | null
}): string {
  return JSON.stringify(
    {
      id: server.id,
      name: server.name,
      url: server.url,
      transport: server.transport,
      enabled: server.enabled,
      connectionStatus: server.connectionStatus,
    },
    null,
    2
  )
}

/**
 * Serialize a skill for VFS agent/skills/{name}.json
 */
export function serializeSkill(s: {
  id: string
  name: string
  description: string
  content: string
  createdAt: Date
}): string {
  return JSON.stringify(
    {
      id: s.id,
      name: s.name,
      description: s.description,
      content: s.content,
      createdAt: s.createdAt.toISOString(),
    },
    null,
    2
  )
}

/** Serialize a Sim sandbox for VFS agent/sandboxes/{name}.json. */
export function serializeSandbox(sandbox: Sandbox, strategy: 'prebuilt' | 'runtime'): string {
  return JSON.stringify(
    {
      id: sandbox.id,
      name: sandbox.name,
      language: sandbox.language,
      dependencies: sandbox.dependencies,
      systemPackages: sandbox.systemPackages,
      cliTools: sandbox.cliTools,
      strategy,
      buildStatus: sandbox.buildStatus,
      errorCode: sandbox.errorCode,
      errorMessage: sandbox.errorMessage,
      errorDetail: sandbox.errorDetail,
      builtAt: sandbox.builtAt,
      createdAt: sandbox.createdAt,
      updatedAt: sandbox.updatedAt,
    },
    null,
    2
  )
}

/**
 * Generate the authoritative Sim-sandbox capability reference exposed in VFS.
 * The managed-CLI rows come directly from the same client-safe registry used by
 * validation and the settings UI, so adding or upgrading a CLI updates agent
 * discovery without a second hand-maintained list.
 */
export function serializeSandboxCatalog(strategy: 'prebuilt' | 'runtime'): string {
  const rows = SANDBOX_SELECTABLE_CLI_TOOL_IDS.map((id) => {
    const tool = SANDBOX_CLI_TOOLS[id]
    const aliases = tool.searchTerms?.join(', ') || '(none)'
    return `| \`${tool.id}\` | ${tool.label} | ${tool.category} | ${tool.description} | ${aliases} |`
  })

  return [
    '# Sim Sandbox Capabilities',
    '',
    'This file is generated from the active Sim sandbox registry. Treat it as the authoritative catalog; do not guess or reuse managed CLI ids from memory.',
    '',
    `- Active dependency strategy: \`${strategy}\``,
    '- Dependency languages: `javascript` installs npm packages; `python` installs PyPI packages. Shell execution may select either language.',
    '- `systemPackages` accepts Debian package coordinates in `package[:architecture][=version]` form.',
    `- \`cliTools\` accepts at most ${MAX_SANDBOX_CLI_TOOLS} exact pinned ids from the catalog below.`,
    '- A Sim sandbox may combine language dependencies, Debian system packages, and managed CLIs.',
    '',
    '## Managed CLI catalog',
    '',
    '| Exact id | Name | Category | What it provides | Search terms / executables |',
    '|----------|------|----------|------------------|----------------------------|',
    ...rows,
    '',
  ].join('\n')
}

/**
 * Serialize an integration/tool schema for VFS components/integrations/{service}/{operation}.json
 */
export function serializeIntegrationSchema(
  tool: ExecutableToolConfig,
  options?: Pick<ComponentSerializationOptions, 'hosted' | 'ownerBlockType'> & {
    oauthAvailable?: boolean
  }
): string {
  const hosted = options?.hosted ?? isHosted
  const auth = serializeToolAuth(tool, hosted, options?.ownerBlockType)
  const hostedApiKeyParam =
    auth?.type === 'api_key' && auth.mode === 'hosted_or_byok' ? auth.param : null

  return JSON.stringify(
    {
      // The full registry id is the agent-callable id (deferred tools are sent
      // with this exact id; no stripping). Surface it verbatim so "copy the id
      // field and load it" matches the callable tool and the block's tools.access.
      id: tool.id,
      name: tool.name,
      description: getCopilotToolDescription(tool, {
        isHosted: hosted,
        hostedApiKey: deriveHostedApiKeySupport(tool.hosting),
      }),
      version: tool.version,
      auth,
      oauth:
        tool.oauth && options?.oauthAvailable !== false
          ? { required: tool.oauth.required, provider: tool.oauth.provider }
          : undefined,
      params: tool.params
        ? {
            ...Object.fromEntries(
              Object.entries(tool.params)
                .filter(([key, val]) => val != null && key !== hostedApiKeyParam)
                .map(([key, val]) => [
                  key,
                  {
                    type: val.type,
                    required: val.required,
                    description: val.description,
                    default: val.default,
                  },
                ])
            ),
            ...(tool.oauth?.required && {
              credentialId: {
                type: 'string',
                required: false,
                description:
                  'Credential ID to use for this OAuth tool call. For Copilot/Superagent execution, pass this explicitly. Get valid IDs from environment/credentials.json.',
              },
            }),
          }
        : undefined,
      outputs: tool.outputs
        ? Object.fromEntries(
            Object.entries(tool.outputs)
              .filter(([, val]) => val != null)
              .map(([key, val]) => [key, { type: val.type, description: val.description }])
          )
        : undefined,
    },
    null,
    2
  )
}

/**
 * Derived setup reference for `slack_oauth` — the same material the custom-bot
 * setup wizard shows, surfaced so the copilot can walk a user (or the browser
 * agent) through Slack app creation without guessing. None of this is a block
 * field: the manifest is a template for api.slack.com, and the Request URL is a
 * per-credential property (`requestUrl` in environment/credentials.json).
 */
function slackOAuthSetupReference(): Record<string, unknown> {
  const defaults = SLACK_CAPABILITIES.filter((c) => c.defaultChecked).map((c) => c.id)
  return {
    note:
      'Setup reference (derived; NOT block fields). A custom bot is a reusable workspace credential: ' +
      'one Slack app, one Request URL, shared by every trigger that selects it. To create or rotate one, ' +
      'emit a service_account credential card for provider "slack" — the wizard collects the signing secret ' +
      'and bot token without them entering the chat. Existing custom bots appear as service_account ' +
      'credentials in environment/credentials.json, each with its requestUrl.',
    requestUrlPattern: '{baseUrl}/api/webhooks/slack/custom/{credentialId}',
    capabilities: SLACK_CAPABILITIES.map((c) => ({
      id: c.id,
      label: c.label,
      group: c.group,
      defaultChecked: c.defaultChecked,
      scopes: c.scopes,
      events: c.events,
    })),
    defaultManifest: buildSlackManifest(new Set(defaults), {
      appName: 'Sim Bot',
      webhookUrl: '<the credential requestUrl>',
    }),
  }
}

/**
 * Serialize a trigger schema for VFS components/triggers/{provider}/{id}.json
 */
export function serializeTriggerSchema(trigger: {
  id: string
  name: string
  provider: string
  description: string
  version: string
  subBlocks: SubBlockConfig[]
  outputs: Record<string, unknown>
  webhook?: { method?: string; headers?: Record<string, string> }
}): string {
  return JSON.stringify(
    {
      id: trigger.id,
      name: trigger.name,
      provider: trigger.provider,
      description: trigger.description,
      version: trigger.version,
      webhook: trigger.webhook || undefined,
      subBlocks: trigger.subBlocks.map(serializeSubBlock),
      outputs: trigger.outputs,
      ...(trigger.id === 'slack_oauth' ? { setup: slackOAuthSetupReference() } : {}),
    },
    null,
    2
  )
}

/**
 * Serialize a built-in trigger block for VFS components/triggers/sim/{type}.json
 */
export function serializeBuiltinTriggerSchema(block: BlockConfig): string {
  return JSON.stringify(
    {
      type: block.type,
      name: block.name,
      description: block.description,
      longDescription: block.longDescription || undefined,
      category: 'builtin',
      triggers: block.triggers || undefined,
      subBlocks: block.subBlocks.map(serializeSubBlock),
      inputs: block.inputs,
      outputs: block.outputs,
    },
    null,
    2
  )
}

interface TriggerOverviewEntry {
  id: string
  name: string
  provider: string
  description: string
}

/**
 * Serialize a triggers.md overview for VFS components/triggers/triggers.md
 */
export function serializeTriggerOverview(
  builtinTriggers: TriggerOverviewEntry[],
  externalTriggers: TriggerOverviewEntry[]
): string {
  const lines: string[] = ['# Triggers', '']

  lines.push('## Built-in Triggers', '')
  lines.push('| ID | Name | Description |')
  lines.push('|----|------|-------------|')
  for (const t of builtinTriggers) {
    lines.push(`| ${t.id} | ${t.name} | ${t.description} |`)
  }

  lines.push('')
  lines.push('## External Triggers', '')
  lines.push('| Provider | ID | Name | Description |')
  lines.push('|----------|----|------|-------------|')
  for (const t of externalTriggers) {
    lines.push(`| ${t.provider} | ${t.id} | ${t.name} | ${t.description} |`)
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * tables/{name}/views.json — the table's saved views in the column-NAME
 * domain agents speak (stored configs are id-keyed; the caller translates).
 * Layout-only fields (order, widths, pinned) are omitted: they are UI
 * concerns and never change which rows a view selects.
 */
export function serializeTableViews(
  views: Array<{
    id: string
    name: string
    isDefault: boolean
    filter?: unknown
    sort?: unknown
    hiddenColumns?: string[]
    updatedAt: Date | string
  }>
): string {
  return JSON.stringify(
    {
      views: views.map((view) => ({
        id: view.id,
        name: view.name,
        isDefault: view.isDefault,
        filter: view.filter ?? null,
        sort: view.sort ?? null,
        hiddenColumns: view.hiddenColumns?.length ? view.hiddenColumns : undefined,
        updatedAt: view.updatedAt instanceof Date ? view.updatedAt.toISOString() : view.updatedAt,
      })),
      note: 'Query a view via query_user_table {operation: "query_rows", args: {tableId, view: "<view id>"}} — the saved filter ANDs with any extra filter you pass. Manage views via the table agent (table_views).',
    },
    null,
    2
  )
}

/**
 * `account/workspace.json` — the current workspace as this viewer sees it:
 * identity, the viewer's effective permission, org linkage, and fork parentage.
 *
 * Owns the current-workspace record. Org detail lives in
 * `organization/organization.json` and fork topology in
 * `organization/forks.json`; both are referenced here by id-and-name stub only,
 * so a fact can never disagree with the file that owns it.
 */
export function serializeAccountWorkspace(input: {
  workspace: { id: string; name: string; workspaceMode?: string | null }
  viewer: { permission: string | null; organizationRole?: string | null }
  organization: { id: string; name?: string | null } | null
  forkedFrom: { id: string; name: string } | null
  entitlements: string[]
}): string {
  return JSON.stringify(
    {
      id: input.workspace.id,
      name: input.workspace.name,
      ...(input.workspace.workspaceMode ? { mode: input.workspace.workspaceMode } : {}),
      yourPermission: input.viewer.permission,
      organization: input.organization
        ? {
            id: input.organization.id,
            ...(input.organization.name ? { name: input.organization.name } : {}),
            ...(input.viewer.organizationRole ? { yourRole: input.viewer.organizationRole } : {}),
            detail: 'organization/organization.json',
          }
        : null,
      forkedFrom: input.forkedFrom
        ? {
            id: input.forkedFrom.id,
            name: input.forkedFrom.name,
            detail: 'organization/forks.json',
          }
        : null,
      entitlements: input.entitlements,
      note: 'Read-only. Your accessible workspaces are in account/workspaces.json; members in account/members.json; plan and usage in account/billing.json.',
    },
    null,
    2
  )
}

/**
 * `account/workspaces.json` — every workspace the viewer can reach, as stubs.
 *
 * Deliberately a roster, not a set of records: id, name, the viewer's role, and
 * org/fork parentage by id. Anything richer about the *current* workspace is in
 * `account/workspace.json`; other workspaces are not readable from here at all.
 */
export function serializeAccountWorkspaces(
  workspaces: Array<{
    id: string
    name: string
    role: string
    organizationId?: string | null
    forkedFromWorkspaceId?: string | null
    isCurrent: boolean
  }>
): string {
  return JSON.stringify(
    {
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        yourRole: workspace.role,
        ...(workspace.organizationId ? { organizationId: workspace.organizationId } : {}),
        ...(workspace.forkedFromWorkspaceId
          ? { forkedFromWorkspaceId: workspace.forkedFromWorkspaceId }
          : {}),
        ...(workspace.isCurrent ? { isCurrent: true } : {}),
      })),
      note: 'Only the current workspace (isCurrent) is mounted in this VFS — the others are listed so you can name them, not read them. Switching workspaces is the user’s action, not yours.',
    },
    null,
    2
  )
}

/**
 * `account/members.json` — who is in the current workspace, with roles.
 *
 * `includeContactDetails` is the viewer's own admin bit: emails and pending
 * invitations are the same privilege as the members settings page, so a
 * non-admin viewer gets names and roles without contact details.
 */
export function serializeAccountMembers(
  members: Array<{
    userId: string
    name: string | null
    email: string | null
    permissionType: string
    isExternal?: boolean
    roleSource?: string
  }>,
  options: { includeContactDetails: boolean }
): string {
  return JSON.stringify(
    {
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name ?? null,
        ...(options.includeContactDetails && member.email ? { email: member.email } : {}),
        role: member.permissionType,
        ...(member.isExternal ? { isExternal: true } : {}),
        ...(member.roleSource && member.roleSource !== 'explicit'
          ? { roleSource: member.roleSource }
          : {}),
      })),
      total: members.length,
      ...(options.includeContactDetails
        ? {}
        : { note: 'Email addresses are shown to workspace admins only.' }),
    },
    null,
    2
  )
}

/**
 * `account/billing.json` — the acting user's live plan, usage, and credits.
 *
 * The only file that carries money and usage numbers; `organization.json` links
 * here rather than repeating them. Read at request time, so the numbers are
 * current rather than as-of-materialization.
 */
export function serializeAccountBilling(snapshot: {
  plan: string
  billingScope: 'user' | 'organization'
  organizationId: string | null
  usage: {
    currentPeriodCost: number
    limit: number
    remaining: number
    percentUsed: number
    isExceeded: boolean
    billingPeriodEnd: Date | string | null
  }
  credits: { balance: number; scope: 'user' | 'organization' }
}): string {
  const periodEnd = snapshot.usage.billingPeriodEnd
  return JSON.stringify(
    {
      plan: snapshot.plan,
      billedTo: snapshot.billingScope,
      ...(snapshot.organizationId ? { organizationId: snapshot.organizationId } : {}),
      usage: {
        currentPeriodCost: snapshot.usage.currentPeriodCost,
        limit: snapshot.usage.limit,
        remaining: snapshot.usage.remaining,
        percentUsed: snapshot.usage.percentUsed,
        isExceeded: snapshot.usage.isExceeded,
        billingPeriodEnd: periodEnd instanceof Date ? periodEnd.toISOString() : periodEnd,
      },
      credits: { balance: snapshot.credits.balance, scope: snapshot.credits.scope },
      note: 'Live values for the acting user, read at access time. What the plan tiers and credits mean is a documentation question, not a value in this file.',
    },
    null,
    2
  )
}

/**
 * `organization/organization.json` — the org that hosts this workspace and the
 * viewer's standing in it. Owns the organization record; plan economics stay in
 * `account/billing.json`.
 */
export function serializeOrganization(input: {
  organization: { id: string; relationship: string; role: string | null }
  capabilities: { canManageOrganization: boolean; canManageBilling: boolean }
  plan: string | null
  isEnterprise: boolean
}): string {
  return JSON.stringify(
    {
      id: input.organization.id,
      yourRelationship: input.organization.relationship,
      yourRole: input.organization.role,
      canManageOrganization: input.capabilities.canManageOrganization,
      canManageBilling: input.capabilities.canManageBilling,
      ...(input.plan ? { plan: input.plan } : {}),
      isEnterprise: input.isEnterprise,
      note: 'Plan usage and credits are in account/billing.json. Your effective restrictions are in organization/access-control.json.',
    },
    null,
    2
  )
}

/**
 * `organization/access-control.json` — who can see and do what, from the
 * viewer's vantage: the permission group governing them and the restrictions it
 * actually imposes.
 *
 * Scoped to the viewer on purpose. The full group roster is an org-admin
 * settings surface, not workspace context.
 */
export function serializeAccessControl(input: {
  entitled: boolean
  permissionGroup: { id: string; name: string; resolution: string } | null
  restrictions: Array<{ key: string; description: string }>
}): string {
  return JSON.stringify(
    {
      entitled: input.entitled,
      governingPermissionGroup: input.permissionGroup
        ? {
            id: input.permissionGroup.id,
            name: input.permissionGroup.name,
            appliedBecause: input.permissionGroup.resolution,
          }
        : null,
      activeRestrictions: input.restrictions.map((restriction) => ({
        key: restriction.key,
        description: restriction.description,
      })),
      note: 'These restrictions are enforced server-side on every action, so a blocked request fails no matter how it is phrased. They describe THIS user; other members may be governed by different groups.',
    },
    null,
    2
  )
}

/**
 * `organization/custom-blocks.json` — names-only index of org-published
 * blocks, mirroring the root pattern: the index lists, the per-item file
 * carries depth. Everything beyond name/enabled lives in
 * `organization/custom-blocks/{type}.json`.
 */
export function serializeOrganizationCustomBlocks(
  blocks: Array<{
    type: string
    name: string
    description?: string | null
    enabled: boolean
    workflowId: string
    workflowName?: string | null
    workspaceId: string | null
    workspaceName?: string | null
  }>
): string {
  return JSON.stringify(
    {
      customBlocks: blocks.map((block) => ({
        type: block.type,
        name: block.name,
        enabled: block.enabled,
        detail: `organization/custom-blocks/${block.type}.json`,
      })),
      note: 'Names only — provenance and the deployed workflow graph are in each detail file. Start at organization/README.md.',
    },
    null,
    2
  )
}

/**
 * `organization/custom-blocks/{type}.json` — one published block in depth:
 * provenance, the callable-schema pointer, and a READ-ONLY view of the
 * deployed workflow graph backing it (blocks/edges as deployed, not the
 * publishing workspace's live editor state). Publishing a block org-wide is
 * the act of sharing it, which is what justifies this cross-workspace read.
 */
export function serializeOrgCustomBlockDetail(
  block: {
    type: string
    name: string
    description?: string | null
    enabled: boolean
    workflowId: string
    workflowName?: string | null
    workspaceId: string | null
    workspaceName?: string | null
  },
  deployedState: unknown
): string {
  return JSON.stringify(
    {
      type: block.type,
      name: block.name,
      ...(block.description ? { description: block.description } : {}),
      enabled: block.enabled,
      publishedFrom: {
        workflowId: block.workflowId,
        ...(block.workflowName ? { workflowName: block.workflowName } : {}),
        ...(block.workspaceId ? { workspaceId: block.workspaceId } : {}),
        ...(block.workspaceName ? { workspaceName: block.workspaceName } : {}),
      },
      ...(block.enabled ? { schema: `components/blocks/${block.type}.json` } : {}),
      deployedWorkflowState: deployedState,
      note: 'Read-only: this is the DEPLOYED graph the block executes, not live editor state, and it cannot be edited from here. Credential ids and {{ENV_VAR}} references inside it belong to the publishing workspace and resolve only there. To wire the block into a workflow, use its schema under components/blocks/.',
    },
    null,
    2
  )
}

/**
 * `organization/README.md` — the namespace guide, playing the role
 * WORKSPACE.md plays at the root: what each file is for and how to use it,
 * plus the in-depth custom-block inventory the names-only index defers.
 */
export function buildOrganizationReadme(input: {
  organizationId: string
  isEnterprise: boolean
  customBlocks: Array<{
    type: string
    name: string
    enabled: boolean
    workflowName?: string | null
    workspaceName?: string | null
  }>
  forksMounted: boolean
  permissionGroupsMounted: boolean
  connectedAccountsMounted: boolean
}): string {
  const lines: string[] = [
    '# Organization',
    '',
    `Read-only truth about organization \`${input.organizationId}\` as the acting user sees it. Nothing here is writable — org membership, permission groups, block publishing, and forking are all managed in the Sim UI.`,
    '',
    '## Files',
    '',
    '- `organization.json` — org identity, your relationship (internal/external) and role, who can manage it. Plan usage and credits live in `account/billing.json`, not here.',
    '- `access-control.json` — the permission group governing YOU and the restrictions it enforces. Restrictions are enforced server-side on every action, so consult this before promising an action is possible. It describes this user only.',
    '- `custom-blocks.json` — names-only index of org-published blocks.',
    '- `custom-blocks/{type}.json` — one block in depth: provenance and a read-only view of the DEPLOYED workflow graph backing it (org members only). To add the block to a workflow, use its callable schema at `components/blocks/{type}.json`; the deployed graph is for understanding what the block does, not for editing.',
    '- `workspaces.json` — every workspace in the organization with your access flag and fork parentage (org members only).',
  ]
  if (input.permissionGroupsMounted) {
    lines.push(
      '- `permission-groups.json` — the admin roster: every group with member count, targeted workspaces, and active restrictions.'
    )
  }
  if (input.connectedAccountsMounted) {
    lines.push(
      '- `connected-accounts.json` — the workspace’s account configuration and provider readiness (workspace admins only). Use the Connected Accounts block in workflows.'
    )
  }
  if (input.forksMounted) {
    lines.push(
      "- `forks.json` — this workspace's place in the fork tree and what was mapped from the parent. Forking, promoting, and rolling back are admin actions in the UI."
    )
  }
  lines.push('', '## Published custom blocks', '')
  if (input.customBlocks.length === 0) {
    lines.push('None published yet.')
  } else {
    for (const block of input.customBlocks) {
      const from = [block.workflowName, block.workspaceName].filter(Boolean).join(' in ')
      lines.push(
        `- **${block.name}** (\`${block.type}\`)${block.enabled ? '' : ' — disabled'}${from ? ` — published from ${from}` : ''}`
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * `organization/workspaces.json` — the org's workspace map: every workspace in
 * the organization, with whether the viewer can open it and its fork
 * parentage. Broader than `account/workspaces.json`, which lists only what the
 * viewer can reach.
 */
export function serializeOrganizationWorkspaces(
  workspaces: Array<{
    id: string
    name: string
    hasAccess: boolean
    forkedFromWorkspaceId?: string | null
  }>
): string {
  return JSON.stringify(
    {
      workspaces: workspaces.map((entry) => ({
        id: entry.id,
        name: entry.name,
        hasAccess: entry.hasAccess,
        ...(entry.forkedFromWorkspaceId
          ? { forkedFromWorkspaceId: entry.forkedFromWorkspaceId }
          : {}),
      })),
      note: 'Every workspace in the organization. hasAccess is YOUR access; workspaces without it are nameable, not readable, and only the current workspace is mounted in this VFS.',
    },
    null,
    2
  )
}

/**
 * `organization/permission-groups.json` — the org-admin roster: every group
 * with member count, targeted workspaces, and the restrictions its config
 * activates. `access-control.json` stays the per-viewer view; this is the
 * management matrix.
 */
export function serializePermissionGroupRoster(
  groups: Array<{
    id: string
    name: string
    description: string | null
    isDefault: boolean
    memberCount: number
    workspaces: Array<{ id: string; name: string }>
    activeRestrictions: Array<{ key: string; description: string }>
  }>
): string {
  return JSON.stringify(
    {
      permissionGroups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        ...(group.description ? { description: group.description } : {}),
        isDefault: group.isDefault,
        memberCount: group.memberCount,
        workspaces: group.workspaces,
        activeRestrictions: group.activeRestrictions,
      })),
      note: 'Management view (org admins). The group governing THIS user, with resolution reason, is in access-control.json. Group membership and scopes are edited in the Sim UI.',
    },
    null,
    2
  )
}

/** Serializes the singleton account configuration, excluding credentials and enrollee data. */
export function serializeConnectedAccounts(accounts: {
  status: 'active' | 'disabled'
  options: Array<{
    provider: string
    label?: string | null
    required?: boolean
    status: 'active' | 'disabled'
    configurationStatus: string
  }>
}): string {
  return JSON.stringify(
    {
      status: accounts.status,
      options: accounts.options.map((option) => ({
        provider: option.provider,
        ...(option.label ? { label: option.label } : {}),
        ...(option.required !== undefined ? { required: option.required } : {}),
        status: option.status,
        configurationStatus: option.configurationStatus,
      })),
      note: 'Manage these accounts in Settings > Connected accounts. Workflows use the Connected Accounts block in their own workspace; no container selection is required. Search uses each person’s connected account to determine document access. Account configuration does not grant access to another person’s credentials or documents.',
    },
    null,
    2
  )
}

/**
 * `organization/forks.json` — this workspace's place in the fork tree plus the
 * parent/child resource and block mappings.
 *
 * Owns fork topology; rosters elsewhere carry only `forkedFromWorkspaceId`.
 * Mapping counts are summarized per resource type — the raw id pairs are an
 * implementation detail of promote/rollback, not workspace context.
 */
export function serializeWorkspaceForks(input: {
  parent: { id: string; name: string } | null
  children: Array<{ id: string; name: string; createdAt: Date | string }>
  resourceMappingCounts: Record<string, number>
  blockMappingCount: number
}): string {
  return JSON.stringify(
    {
      parent: input.parent,
      children: input.children.map((child) => ({
        id: child.id,
        name: child.name,
        createdAt:
          child.createdAt instanceof Date ? child.createdAt.toISOString() : child.createdAt,
      })),
      ...(input.parent
        ? {
            mappedFromParent: {
              resources: input.resourceMappingCounts,
              blocks: input.blockMappingCount,
            },
          }
        : {}),
      note: 'A forked workspace keeps a mapping back to the resources it was copied from, which is what promote and rollback follow. Forking, promoting, and rolling back are workspace-admin actions in the UI — you cannot perform them.',
    },
    null,
    2
  )
}
