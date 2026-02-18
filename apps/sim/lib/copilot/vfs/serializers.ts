import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Serialize workflow metadata for VFS meta.json
 */
export function serializeWorkflowMeta(wf: {
  id: string
  name: string
  description?: string | null
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
 * Serialize a SubBlockConfig for the VFS component schema.
 * Strips functions and UI-only fields.
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
  return result
}

/**
 * Serialize a block schema for VFS components/blocks/{type}.json
 */
export function serializeBlockSchema(block: BlockConfig): string {
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
      subBlocks: block.subBlocks.map(serializeSubBlock),
      inputs: block.inputs,
      outputs: Object.fromEntries(
        Object.entries(block.outputs)
          .filter(([key]) => key !== 'visualization')
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
 * Shows which integrations are connected — IDs and scopes, NOT tokens.
 */
export function serializeCredentials(
  accounts: Array<{
    providerId: string
    scope: string | null
    createdAt: Date
  }>
): string {
  return JSON.stringify(
    accounts.map((a) => ({
      provider: a.providerId,
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

/**
 * Serialize an integration/tool schema for VFS components/integrations/{service}/{operation}.json
 */
export function serializeIntegrationSchema(tool: ToolConfig): string {
  return JSON.stringify(
    {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      version: tool.version,
      oauth: tool.oauth
        ? { required: tool.oauth.required, provider: tool.oauth.provider }
        : undefined,
      params: Object.fromEntries(
        Object.entries(tool.params).map(([key, val]) => [
          key,
          {
            type: val.type,
            required: val.required,
            description: val.description,
            default: val.default,
          },
        ])
      ),
      outputs: tool.outputs
        ? Object.fromEntries(
            Object.entries(tool.outputs).map(([key, val]) => [
              key,
              { type: val.type, description: val.description },
            ])
          )
        : undefined,
    },
    null,
    2
  )
}
