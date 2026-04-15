import { getCopilotToolDescription } from '@/lib/copilot/tools/descriptions'
import { isHosted } from '@/lib/core/config/feature-flags'
import { isSubBlockHidden } from '@/lib/workflows/subblocks/visibility'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { PROVIDER_DEFINITIONS } from '@/providers/models'
import type { ToolConfig } from '@/tools/types'

/**
 * Serialize workflow metadata for VFS meta.json
 */
export function serializeWorkflowMeta(wf: {
  id: string
  name: string
  description?: string | null
  folderId?: string | null
  isDeployed: boolean
  deployedAt?: Date | null
  runCount: number
  lastRunAt?: Date | null
  createdAt: Date
  updatedAt: Date
}): string {
  return JSON.stringify(
    {
      id: wf.id,
      name: wf.name,
      description: wf.description || undefined,
      folderId: wf.folderId || undefined,
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
 * Serialize knowledge base metadata for VFS meta.json
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
 * Shows connector type, sync status, and schedule — NOT credentials or source config.
 */
export function serializeConnectors(
  connectors: Array<{
    id: string
    connectorType: string
    status: string
    syncMode: string
    syncIntervalMinutes: number
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
 * Serialize workspace file metadata for VFS files/{name}/meta.json
 * and files/by-id/{id}/meta.json.
 */
export function serializeFileMeta(file: {
  id: string
  name: string
  contentType: string
  size: number
  uploadedAt: Date
}): string {
  return JSON.stringify(
    {
      id: file.id,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
      uploadedAt: file.uploadedAt.toISOString(),
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
function getStaticModelOptionsForVFS(): Array<{
  id: string
  provider: string
  hosted: boolean
}> {
  const hostedProviders = new Set(['openai', 'anthropic', 'google'])
  const dynamicProviders = new Set(['ollama', 'vllm', 'openrouter', 'fireworks'])

  const models: Array<{ id: string; provider: string; hosted: boolean }> = []

  for (const [providerId, def] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (dynamicProviders.has(providerId)) continue
    for (const model of def.models) {
      models.push({
        id: model.id,
        provider: providerId,
        hosted: hostedProviders.has(providerId),
      })
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
  if (sb.canonicalParamId) result.canonicalParamId = sb.canonicalParamId

  // Include static options arrays for dropdowns
  if (Array.isArray(sb.options)) {
    result.options = sb.options
  }

  return result
}

/**
 * Serialize a block schema for VFS components/blocks/{type}.json
 */
export function serializeBlockSchema(block: BlockConfig): string {
  const hiddenIds = new Set(block.subBlocks.filter(isSubBlockHidden).map((sb) => sb.id))

  const subBlocks = block.subBlocks
    .filter((sb) => !hiddenIds.has(sb.id))
    .map((sb) => {
      const serialized = serializeSubBlock(sb)

      // For model comboboxes with function options, inject static model data with hosting info
      if (sb.id === 'model' && sb.type === 'combobox' && typeof sb.options === 'function') {
        serialized.options = getStaticModelOptionsForVFS()
      }

      return serialized
    })

  const inputs =
    block.inputs && hiddenIds.size > 0
      ? Object.fromEntries(Object.entries(block.inputs).filter(([key]) => !hiddenIds.has(key)))
      : block.inputs

  return JSON.stringify(
    {
      type: block.type,
      name: block.name,
      description: block.description,
      category: block.category,
      longDescription: block.longDescription || undefined,
      bestPractices: block.bestPractices || undefined,
      triggerAllowed: block.triggerAllowed || undefined,
      singleInstance: block.singleInstance || undefined,
      tools: block.tools.access,
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
    role?: string | null
    scope: string | null
    createdAt: Date
  }>
): string {
  return JSON.stringify(
    accounts.map((a) => ({
      id: a.id || undefined,
      provider: a.providerId,
      displayName: a.displayName || undefined,
      role: a.role || undefined,
      scope: a.scope || undefined,
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

/**
 * Serialize environment variables for VFS environment/variables.json.
 * Shows variable NAMES only — NOT values.
 */
export function serializeEnvironmentVariables(
  personalVarNames: string[],
  workspaceVarNames: string[]
): string {
  return JSON.stringify(
    {
      personal: personalVarNames,
      workspace: workspaceVarNames,
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
  } | null
  form?: {
    id: string
    identifier: string
    title: string
    description?: string | null
    authType: string
    showBranding: boolean
    customizations: unknown
    isActive: boolean
  } | null
  mcp: Array<{
    serverId: string
    serverName: string
    toolId: string
    toolName: string
    toolDescription?: string | null
  }>
  a2a?: {
    id: string
    name: string
    description?: string | null
    version: string
    isPublished: boolean
    capabilities: unknown
  } | null
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

  if (data.isDeployed) {
    result.api = {
      isDeployed: true,
      deployedAt: data.deployedAt?.toISOString(),
      apiEndpoint: `/api/workflows/${data.workflowId}/execute`,
      ...(data.api ? { version: data.api.version } : {}),
    }
  }

  if (data.chat) {
    result.chat = {
      id: data.chat.id,
      identifier: data.chat.identifier,
      chatUrl: `/chat/${data.chat.identifier}`,
      title: data.chat.title,
      description: data.chat.description || undefined,
      authType: data.chat.authType,
      customizations: data.chat.customizations,
      isActive: data.chat.isActive,
    }
  }

  if (data.form) {
    result.form = {
      id: data.form.id,
      identifier: data.form.identifier,
      formUrl: `/form/${data.form.identifier}`,
      title: data.form.title,
      description: data.form.description || undefined,
      authType: data.form.authType,
      showBranding: data.form.showBranding,
      customizations: data.form.customizations,
      isActive: data.form.isActive,
    }
  }

  if (data.mcp.length > 0) {
    result.mcp = data.mcp.map((m) => ({
      serverId: m.serverId,
      serverName: m.serverName,
      toolId: m.toolId,
      toolName: m.toolName,
      toolDescription: m.toolDescription || undefined,
    }))
  }

  if (data.a2a) {
    result.a2a = {
      id: data.a2a.id,
      name: data.a2a.name,
      description: data.a2a.description || undefined,
      version: data.a2a.version,
      isPublished: data.a2a.isPublished,
      capabilities: data.a2a.capabilities,
      agentUrl: `/api/a2a/serve/${data.a2a.id}`,
    }
  }

  return JSON.stringify(result, null, 2)
}

/**
 * Serialize deployment version history for VFS workflows/{name}/versions.json.
 * Lists all versions without full state — use get_deployment_version tool to fetch a version's state.
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
      codePreview: tool.code.length > 500 ? `${tool.code.slice(0, 500)}...` : tool.code,
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
      contentPreview: s.content.length > 500 ? `${s.content.slice(0, 500)}...` : s.content,
      createdAt: s.createdAt.toISOString(),
    },
    null,
    2
  )
}

/**
 * Serialize an integration/tool schema for VFS components/integrations/{service}/{operation}.json
 */
export function serializeIntegrationSchema(tool: ToolConfig): string {
  const hostedApiKeyParam = isHosted && tool.hosting ? tool.hosting.apiKeyParam : null

  return JSON.stringify(
    {
      id: tool.id,
      name: tool.name,
      description: getCopilotToolDescription(tool, { isHosted }),
      version: tool.version,
      oauth: tool.oauth
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
 * Serialize job metadata for VFS jobs/{id}/meta.json
 */
export function serializeJobMeta(job: {
  id: string
  title: string | null
  prompt: string
  cronExpression: string | null
  timezone: string | null
  status: string
  lifecycle: string
  successCondition: string | null
  maxRuns: number | null
  runCount: number
  nextRunAt: Date | null
  lastRanAt: Date | null
  sourceTaskName: string | null
  sourceChatId: string | null
  createdAt: Date
}): string {
  return JSON.stringify(
    {
      id: job.id,
      title: job.title || undefined,
      prompt: job.prompt,
      cronExpression: job.cronExpression || undefined,
      timezone: job.timezone || 'UTC',
      status: job.status,
      lifecycle: job.lifecycle,
      successCondition: job.successCondition || undefined,
      maxRuns: job.maxRuns ?? undefined,
      runCount: job.runCount,
      nextRunAt: job.nextRunAt?.toISOString(),
      lastRanAt: job.lastRanAt?.toISOString(),
      sourceTaskName: job.sourceTaskName || undefined,
      sourceChatId: job.sourceChatId || undefined,
      createdAt: job.createdAt.toISOString(),
    },
    null,
    2
  )
}

export function serializeTaskSession(task: {
  id: string
  title: string
  messageCount: number
  createdAt: Date
  updatedAt: Date
}): string {
  return [
    `# ${task.title}`,
    '',
    `- **Chat ID:** ${task.id}`,
    `- **Created:** ${task.createdAt.toISOString()}`,
    `- **Updated:** ${task.updatedAt.toISOString()}`,
    `- **Messages:** ${task.messageCount}`,
    '',
  ].join('\n')
}

export function serializeTaskChat(rawMessages: unknown[]): string {
  const filtered: { role: string; content: string }[] = []

  for (const msg of rawMessages) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as Record<string, unknown>
    const role = m.role as string | undefined
    if (role !== 'user' && role !== 'assistant') continue

    let content = ''
    if (role === 'assistant' && Array.isArray(m.contentBlocks)) {
      const textParts: string[] = []
      for (const block of m.contentBlocks) {
        if (
          block &&
          typeof block === 'object' &&
          (block as any).type === 'text' &&
          (block as any).content
        ) {
          textParts.push((block as any).content)
        }
      }
      content = textParts.join('')
    }

    if (!content && typeof m.content === 'string') {
      content = m.content
    }

    if (!content) continue
    filtered.push({ role, content })
  }

  return JSON.stringify(filtered, null, 2)
}
