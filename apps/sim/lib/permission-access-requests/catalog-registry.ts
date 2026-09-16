import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { env } from '@/lib/core/config/env'
import {
  getAllowedIntegrationsFromEnv,
  getBlacklistedProvidersFromEnv,
  isHosted,
} from '@/lib/core/config/env-flags'
import { isOllamaUrlConfigured } from '@/lib/core/utils/urls'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import {
  isIntegrationDeploymentAvailableForVisibility,
  isOAuthServiceDeploymentAvailable,
} from '@/lib/integrations/availability.server'
import {
  type AccessRequestCatalog,
  type AccessRequestCatalogItem,
  type AccessRequestModelItem,
  type AccessRequestTarget,
  type AccessRequestToolItem,
  createAccessRequestCatalog,
} from '@/lib/permission-groups/access-requests/targets'
import {
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import { getBlockRegistry } from '@/blocks/registry'
import { isHiddenUnder } from '@/blocks/visibility/context'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { DYNAMIC_MODEL_PROVIDERS, PROVIDER_DEFINITIONS } from '@/providers/models'
import { filterBlacklistedModels } from '@/providers/utils'
import { getToolMetadata } from '@/tools/metadata'

export interface AccessRequestCatalogContext {
  userId: string
  organizationId: string
  workspaceId: string | null
}

const DYNAMIC_PROVIDERS: ReadonlySet<string> = new Set(DYNAMIC_MODEL_PROVIDERS)

function isProviderDeploymentAvailable(providerId: string): boolean {
  if (providerId === 'ollama') return !isHosted || isOllamaUrlConfigured()
  if (providerId === 'vllm') return Boolean(env.VLLM_BASE_URL?.trim())
  if (providerId === 'litellm') return Boolean(env.LITELLM_BASE_URL?.trim())
  return true
}

/**
 * Public, built-in choices available to an already-authorized viewer. No custom block, credential,
 * sandbox, or tenant model names are read. The permission group is intentionally not applied here:
 * callers compare it with this deployment ceiling to distinguish requestable restrictions.
 */
export async function loadAccessRequestRegistryCatalog(
  context: AccessRequestCatalogContext,
  targetKind?: AccessRequestTarget['kind']
): Promise<AccessRequestCatalog> {
  const needsBlocks = !targetKind || targetKind === 'integration' || targetKind === 'tool'
  const needsTools = !targetKind || targetKind === 'tool'
  const [visibility, credentialGroupsAvailable] = needsBlocks
    ? await Promise.all([
        getBlockVisibility({
          userId: context.userId,
          orgId: context.organizationId,
          workspaceId: context.workspaceId,
        }),
        isScopedCredentialGroupsAvailable({
          kind: 'organization',
          organizationId: context.organizationId,
        }),
      ])
    : [null, false]
  const allowedIntegrations = toAccessControlAllowlist(getAllowedIntegrationsFromEnv())
  const integrations: AccessRequestCatalogItem[] = []
  const tools = new Map<string, AccessRequestToolItem>()
  const ambiguousTools = new Set<string>()

  for (const block of needsBlocks ? Object.values(getBlockRegistry()) : []) {
    if (
      block.type.startsWith('custom_block_') ||
      block.type === 'start_trigger' ||
      block.hideFromToolbar ||
      (visibility && isHiddenUnder(visibility, block)) ||
      resolveAccessControlBlockType(block.type) !== block.type ||
      (block.type === 'credential_group' && !credentialGroupsAvailable) ||
      (allowedIntegrations !== null && !allowedIntegrations.has(block.type)) ||
      (visibility && !isIntegrationDeploymentAvailableForVisibility(block.type, visibility))
    ) {
      continue
    }
    integrations.push({ id: block.type, label: block.name })
    for (const toolId of needsTools ? (block.tools?.access ?? []) : []) {
      if (ambiguousTools.has(toolId)) continue
      const existing = tools.get(toolId)
      if (existing && existing.integrationId !== block.type) {
        tools.delete(toolId)
        ambiguousTools.add(toolId)
        continue
      }
      const metadata = getToolMetadata(toolId)
      if (!metadata) continue
      tools.set(toolId, {
        id: toolId,
        label: `${block.name}: ${metadata.name || toolId}`,
        integrationId: block.type,
      })
    }
  }

  const blacklistedProviders = new Set(getBlacklistedProvidersFromEnv())
  const providers: AccessRequestCatalogItem[] = []
  const models: AccessRequestModelItem[] = []
  for (const provider of !targetKind || targetKind === 'provider' || targetKind === 'model'
    ? Object.values(PROVIDER_DEFINITIONS)
    : []) {
    if (
      blacklistedProviders.has(provider.id.toLowerCase()) ||
      !isProviderDeploymentAvailable(provider.id)
    ) {
      continue
    }
    providers.push({ id: provider.id, label: provider.name })
    /** Dynamic arrays may contain private names populated by another credential's discovery. */
    if (targetKind === 'provider' || DYNAMIC_PROVIDERS.has(provider.id)) continue
    const availableModelIds = filterBlacklistedModels(
      provider.models
        .filter((model) => model.sunset?.status !== 'deprecated')
        .map((model) => model.id)
    )
    for (const id of availableModelIds) models.push({ id, label: id, providerId: provider.id })
  }

  const knowledgeConnectors = (
    !targetKind || targetKind === 'knowledge_connector'
      ? Object.values(CONNECTOR_META_REGISTRY)
      : []
  )
    .filter(
      (connector) =>
        connector.auth.mode !== 'oauth' ||
        Boolean(connector.auth.apiKey) ||
        isOAuthServiceDeploymentAvailable(connector.auth.provider)
    )
    .map((connector) => ({ id: connector.id, label: connector.name }))

  return createAccessRequestCatalog({
    integrations,
    providers,
    models,
    tools: [...tools.values()],
    knowledgeConnectors,
  })
}
