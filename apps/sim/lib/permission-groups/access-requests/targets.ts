import {
  type BooleanPermissionGroupConfigKey,
  PLATFORM_FEATURES,
} from '@/lib/permission-groups/features'
import {
  FILE_SHARE_AUTH_TYPES,
  PERMISSION_GROUP_FIELDS,
  type PermissionGroupCapabilityScope,
  type PermissionGroupConfig,
  type PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'
import {
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'

export type AccessRequestScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'organization'; organizationId: string }

export type AccessRequestTarget =
  | { kind: 'feature'; configKey: BooleanPermissionGroupConfigKey }
  | { kind: 'integration' | 'provider' | 'model' | 'tool' | 'knowledge_connector'; id: string }
  | { kind: 'file_share_auth' | 'chat_deploy_auth'; id: (typeof FILE_SHARE_AUTH_TYPES)[number] }
  | { kind: 'usage_limit'; id: 'member' }

export const ACCESS_REQUEST_TARGET_KINDS = [
  'feature',
  'integration',
  'provider',
  'model',
  'tool',
  'knowledge_connector',
  'file_share_auth',
  'chat_deploy_auth',
  'usage_limit',
] as const satisfies readonly AccessRequestTarget['kind'][]

export interface AccessRequestCatalogItem {
  id: string
  label: string
}

export interface AccessRequestModelItem extends AccessRequestCatalogItem {
  providerId: string | null
}

export interface AccessRequestToolItem extends AccessRequestCatalogItem {
  integrationId: string | null
}

export interface AccessRequestCatalogInput {
  integrations: readonly AccessRequestCatalogItem[]
  providers: readonly AccessRequestCatalogItem[]
  models: readonly AccessRequestModelItem[]
  tools: readonly AccessRequestToolItem[]
  knowledgeConnectors: readonly AccessRequestCatalogItem[]
}

/** Catalogs come from authorized discovery; executable registries stay out of this module. */
export interface AccessRequestCatalog {
  integrations: ReadonlyMap<string, AccessRequestCatalogItem>
  providers: ReadonlyMap<string, AccessRequestCatalogItem>
  models: ReadonlyMap<string, AccessRequestModelItem>
  tools: ReadonlyMap<string, AccessRequestToolItem>
  knowledgeConnectors: ReadonlyMap<string, AccessRequestCatalogItem>
}

export interface AccessRequestTargetDescription {
  label: string
  scope: PermissionGroupCapabilityScope
  minimumRole: 'read' | 'write'
}

export type AccessRequestPolicyValue = boolean | string[] | null

export interface AccessRequestPolicyChange {
  configKey: PermissionGroupConfigKey
  label: string
  before: AccessRequestPolicyValue
  after: AccessRequestPolicyValue
}

export interface AccessRequestPolicyDelta {
  target: AccessRequestTarget
  targetLabel: string
  config: PermissionGroupConfig
  changes: AccessRequestPolicyChange[]
}

const FEATURES_BY_KEY = new Map(PLATFORM_FEATURES.map((feature) => [feature.configKey, feature]))

/** The parent module must also be available for these actions to become usable. */
const FEATURE_PARENTS: Partial<
  Record<BooleanPermissionGroupConfigKey, readonly BooleanPermissionGroupConfigKey[]>
> = {
  disableKnowledgeBaseCreation: ['hideKnowledgeBaseTab'],
  disableKnowledgeBaseFileUpload: ['hideKnowledgeBaseTab'],
  disableKnowledgeBaseExport: ['hideKnowledgeBaseTab'],
  disableTableCreation: ['hideTablesTab'],
  disableTableExport: ['hideTablesTab'],
  disableBulkFileDownload: ['hideFilesTab'],
  disablePublicFileSharing: ['hideFilesTab'],
  disablePersonalCredentials: ['hideIntegrationsTab'],
}

const WRITE_FEATURES = new Set<BooleanPermissionGroupConfigKey>([
  'hideDeployApi',
  'hideDeployMcp',
  'hideDeployChatbot',
  'disableKnowledgeBaseCreation',
  'disableKnowledgeBaseFileUpload',
  'disableTableCreation',
  'disableInvitations',
  'disablePublicFileSharing',
  'disableWebhookTriggers',
])

/** Built-in blocks whose operations also enter a governed platform module. */
const INTEGRATION_FEATURES = new Map<string, BooleanPermissionGroupConfigKey>([
  ['mcp', 'disableMcpTools'],
  ['knowledge', 'hideKnowledgeBaseTab'],
  ['table_v2', 'hideTablesTab'],
  ['file_v5', 'hideFilesTab'],
])

const TOOL_FEATURES = new Map<string, BooleanPermissionGroupConfigKey>([
  ['knowledge_create_document', 'disableKnowledgeBaseFileUpload'],
  ['knowledge_upsert_document', 'disableKnowledgeBaseFileUpload'],
])

const LIST_FIELD_LABELS = {
  allowedIntegrations: 'Allowed integrations and blocks',
  allowedModelProviders: 'Allowed model providers',
  deniedModels: 'Blocked models',
  deniedTools: 'Blocked tools',
  allowedKnowledgeConnectors: 'Allowed knowledge base connectors',
  allowedFileShareAuthTypes: 'Allowed file sharing authentication',
  allowedChatDeployAuthTypes: 'Allowed chat authentication',
} as const

const AUTH_LABELS = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
} as const

function indexItems<T extends AccessRequestCatalogItem>(
  items: readonly T[],
  normalize: (id: string) => string = (id) => id
): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [normalize(item.id), item]))
}

function normalizeIntegration(id: string): string {
  return resolveAccessControlBlockType(id.toLowerCase()).toLowerCase()
}

/** Index once per discovery, so evaluating every target does not scan every catalog repeatedly. */
export function createAccessRequestCatalog(input: AccessRequestCatalogInput): AccessRequestCatalog {
  return {
    integrations: indexItems(input.integrations, normalizeIntegration),
    providers: indexItems(input.providers),
    models: indexItems(input.models, (id) => id.toLowerCase()),
    tools: indexItems(input.tools),
    knowledgeConnectors: indexItems(input.knowledgeConnectors),
  }
}

/** Rejects unknown IDs and returns the vocabulary the existing permission gates compare. */
export function validateAccessRequestTarget(
  target: AccessRequestTarget,
  catalog: AccessRequestCatalog
): AccessRequestTarget | null {
  switch (target.kind) {
    case 'feature':
      return FEATURES_BY_KEY.has(target.configKey) ? { ...target } : null
    case 'integration': {
      const id = normalizeIntegration(target.id)
      return catalog.integrations.has(id) ? { kind: target.kind, id } : null
    }
    case 'provider':
      return catalog.providers.has(target.id) ? { ...target } : null
    case 'model': {
      const model = catalog.models.get(target.id.toLowerCase())
      if (!model || (model.providerId !== null && !catalog.providers.has(model.providerId))) {
        return null
      }
      return { kind: target.kind, id: model.id }
    }
    case 'tool': {
      const tool = catalog.tools.get(target.id)
      if (
        !tool ||
        (tool.integrationId !== null &&
          !catalog.integrations.has(normalizeIntegration(tool.integrationId)))
      ) {
        return null
      }
      return { kind: target.kind, id: tool.id }
    }
    case 'knowledge_connector':
      return catalog.knowledgeConnectors.has(target.id) ? { ...target } : null
    case 'file_share_auth':
    case 'chat_deploy_auth':
      return FILE_SHARE_AUTH_TYPES.some((authType) => authType === target.id) ? { ...target } : null
    case 'usage_limit':
      return target.id === 'member' ? { ...target } : null
  }
}

/** Stable key for a target already canonicalized by validateAccessRequestTarget. */
export function getAccessRequestTargetKey(target: AccessRequestTarget): string {
  return `${target.kind}:${encodeURIComponent(target.kind === 'feature' ? target.configKey : target.id)}`
}

export function describeAccessRequestTarget(
  target: AccessRequestTarget,
  catalog: AccessRequestCatalog
): AccessRequestTargetDescription | null {
  const canonical = validateAccessRequestTarget(target, catalog)
  if (!canonical) return null
  if (canonical.kind === 'feature') {
    const feature = FEATURES_BY_KEY.get(canonical.configKey)
    if (!feature) return null
    return {
      label: feature.label,
      scope: feature.scope,
      minimumRole: WRITE_FEATURES.has(canonical.configKey) ? 'write' : 'read',
    }
  }
  if (canonical.kind === 'usage_limit') {
    return { label: 'Member usage limit', scope: 'workspace-or-organization', minimumRole: 'read' }
  }
  if (canonical.kind === 'file_share_auth' || canonical.kind === 'chat_deploy_auth') {
    const subject = canonical.kind === 'file_share_auth' ? 'file sharing' : 'chat deployment'
    return {
      label: `${AUTH_LABELS[canonical.id]} ${subject}`,
      scope: 'workspace',
      minimumRole: 'write',
    }
  }
  const items = {
    integration: catalog.integrations,
    provider: catalog.providers,
    model: catalog.models,
    tool: catalog.tools,
    knowledge_connector: catalog.knowledgeConnectors,
  }
  const item = items[canonical.kind].get(
    canonical.kind === 'model' ? canonical.id.toLowerCase() : canonical.id
  )
  if (!item) return null
  return {
    label: item.label,
    scope: 'workspace',
    minimumRole: canonical.kind === 'knowledge_connector' ? 'write' : 'read',
  }
}

export function isAccessRequestTargetInScope(
  target: AccessRequestTarget,
  scope: AccessRequestScope,
  catalog: AccessRequestCatalog
): boolean {
  const description = describeAccessRequestTarget(target, catalog)
  return Boolean(
    description &&
      (description.scope === 'workspace-or-organization' || description.scope === scope.kind)
  )
}

function allowMember<T extends string>(allowed: T[] | null, member: T): T[] | null {
  return allowed === null || allowed.includes(member) ? allowed : [...allowed, member]
}

function requiredFeatures(
  target: AccessRequestTarget,
  catalog: AccessRequestCatalog
): BooleanPermissionGroupConfigKey[] {
  const keys: BooleanPermissionGroupConfigKey[] = []
  if (target.kind === 'feature') keys.push(target.configKey)
  if (target.kind === 'integration') {
    const feature = INTEGRATION_FEATURES.get(target.id)
    if (feature) keys.push(feature)
  }
  if (target.kind === 'tool') {
    const integrationId = catalog.tools.get(target.id)?.integrationId
    const integrationFeature = integrationId && INTEGRATION_FEATURES.get(integrationId)
    if (integrationFeature) keys.push(integrationFeature)
    const feature = TOOL_FEATURES.get(target.id)
    if (feature) keys.push(feature)
  }
  if (target.kind === 'knowledge_connector') keys.push('hideKnowledgeBaseTab')
  if (target.kind === 'file_share_auth') keys.push('disablePublicFileSharing')
  if (target.kind === 'chat_deploy_auth') keys.push('hideDeployChatbot')
  return [...new Set(keys.flatMap((key) => [key, ...(FEATURE_PARENTS[key] ?? [])]))]
}

function integrationDenied(config: PermissionGroupConfig, integrationId: string): boolean {
  return (
    config.allowedIntegrations !== null &&
    !config.allowedIntegrations.some(
      (id) => normalizeIntegration(id) === normalizeIntegration(integrationId)
    )
  )
}

/** Tests denial without copying full policies or their bounded but potentially large denylists. */
export function isAccessRequestTargetDenied(
  target: AccessRequestTarget,
  config: PermissionGroupConfig,
  catalog: AccessRequestCatalog
): boolean {
  const canonical = validateAccessRequestTarget(target, catalog)
  if (!canonical) throw new Error('Unknown access request target')
  if (requiredFeatures(canonical, catalog).some((key) => config[key])) return true
  switch (canonical.kind) {
    case 'feature':
      return false
    case 'integration':
      return integrationDenied(config, canonical.id)
    case 'provider':
      return (
        config.allowedModelProviders !== null &&
        !config.allowedModelProviders.includes(canonical.id)
      )
    case 'model': {
      const providerId = catalog.models.get(canonical.id.toLowerCase())?.providerId
      return (
        config.deniedModels.some((id) => id.toLowerCase() === canonical.id.toLowerCase()) ||
        Boolean(
          providerId &&
            config.allowedModelProviders !== null &&
            !config.allowedModelProviders.includes(providerId)
        )
      )
    }
    case 'tool': {
      const integrationId = catalog.tools.get(canonical.id)?.integrationId
      return (
        config.deniedTools.includes(canonical.id) ||
        Boolean(integrationId && integrationDenied(config, integrationId))
      )
    }
    case 'knowledge_connector':
      return (
        config.allowedKnowledgeConnectors !== null &&
        !config.allowedKnowledgeConnectors.includes(canonical.id)
      )
    case 'file_share_auth':
      return (
        config.allowedFileShareAuthTypes !== null &&
        !config.allowedFileShareAuthTypes.includes(canonical.id)
      )
    case 'chat_deploy_auth':
      return (
        config.allowedChatDeployAuthTypes !== null &&
        !config.allowedChatDeployAuthTypes.includes(canonical.id)
      )
    case 'usage_limit':
      throw new Error('Usage limit requests require a billing limit change')
  }
}

function allowIntegration(config: PermissionGroupConfig, id: string) {
  const allowed = toAccessControlAllowlist(config.allowedIntegrations)
  const canonical = normalizeIntegration(id)
  if (allowed !== null && !allowed.has(canonical)) {
    config.allowedIntegrations = [...(config.allowedIntegrations ?? []), canonical]
  }
}

/**
 * Computes the complete group-policy change. Callers must display every change before applying it;
 * enabling a model's provider, for example, also admits other models from that provider.
 * Usage limits belong to billing and must never be fulfilled through a permission-group mutation.
 */
export function buildAccessRequestPolicyDelta(
  target: AccessRequestTarget,
  config: PermissionGroupConfig,
  catalog: AccessRequestCatalog
): AccessRequestPolicyDelta {
  const canonical = validateAccessRequestTarget(target, catalog)
  const description = canonical && describeAccessRequestTarget(canonical, catalog)
  if (!canonical || !description) throw new Error('Unknown access request target')
  if (canonical.kind === 'usage_limit') {
    throw new Error('Usage limit requests require a billing limit change')
  }
  const next = structuredClone(config)
  for (const configKey of requiredFeatures(canonical, catalog)) next[configKey] = false
  switch (canonical.kind) {
    case 'feature':
      break
    case 'integration':
      allowIntegration(next, canonical.id)
      break
    case 'provider':
      next.allowedModelProviders = allowMember(next.allowedModelProviders, canonical.id)
      break
    case 'model': {
      const model = catalog.models.get(canonical.id.toLowerCase())
      next.deniedModels = next.deniedModels.filter(
        (id) => id.toLowerCase() !== canonical.id.toLowerCase()
      )
      if (model?.providerId) {
        next.allowedModelProviders = allowMember(next.allowedModelProviders, model.providerId)
      }
      break
    }
    case 'tool': {
      const tool = catalog.tools.get(canonical.id)
      next.deniedTools = next.deniedTools.filter((id) => id !== canonical.id)
      if (tool?.integrationId) allowIntegration(next, tool.integrationId)
      break
    }
    case 'knowledge_connector':
      next.allowedKnowledgeConnectors = allowMember(next.allowedKnowledgeConnectors, canonical.id)
      break
    case 'file_share_auth':
      next.allowedFileShareAuthTypes = allowMember(next.allowedFileShareAuthTypes, canonical.id)
      break
    case 'chat_deploy_auth':
      next.allowedChatDeployAuthTypes = allowMember(next.allowedChatDeployAuthTypes, canonical.id)
      break
  }
  const changes: AccessRequestPolicyChange[] = []
  for (const configKey of Object.keys(PERMISSION_GROUP_FIELDS) as PermissionGroupConfigKey[]) {
    const before = config[configKey]
    const after = next[configKey]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const field = PERMISSION_GROUP_FIELDS[configKey]
    const label =
      field.kind === 'boolean-restriction'
        ? field.feature.label
        : LIST_FIELD_LABELS[configKey as keyof typeof LIST_FIELD_LABELS]
    changes.push({
      configKey,
      label,
      before: structuredClone(before),
      after: structuredClone(after),
    })
  }
  return { target: canonical, targetLabel: description.label, config: next, changes }
}
