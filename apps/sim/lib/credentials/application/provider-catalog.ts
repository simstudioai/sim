import type { Principal } from '@sim/auth/principal'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createIntegrationCredentialVisibility } from '@/lib/integrations/credential-visibility.server'
import { getAllOAuthServices, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

export interface CredentialProviderAuthorizationOption {
  providerId: string
  label: string
}

export interface CredentialProviderCatalogEntry {
  serviceId: string
  name: string
  description: string
  providerFamily: string
  available: boolean
  supportsReconnect: boolean
  authorizationOptions: CredentialProviderAuthorizationOption[]
}

interface CredentialProviderCatalogContext {
  workspaceId: string
  workspaceOrganizationId: string | null
}

function principalUserId(principal: Principal): string | undefined {
  if (principal.kind === 'session' || principal.kind === 'personal_api_key') {
    return principal.userId
  }
  if (principal.kind === 'delegated') return principal.subjectUserId
  return undefined
}

async function allowedIntegrationTypes(
  principal: Principal,
  workspaceId: string
): Promise<ReadonlySet<string> | null> {
  const userId = principalUserId(principal)
  const permissionConfig = userId ? await getUserPermissionConfig(userId, workspaceId) : null
  const integrations = intersectIntegrationAllowlists(
    permissionConfig?.allowedIntegrations ?? null,
    getAllowedIntegrationsFromEnv()
  )
  return integrations ? new Set(integrations.map((type) => type.toLowerCase())) : null
}

export async function listCredentialProviderCatalog(
  principal: Principal,
  context: CredentialProviderCatalogContext
): Promise<CredentialProviderCatalogEntry[]> {
  const userId = principalUserId(principal)
  const [allowedIntegrations, blockVisibility] = await Promise.all([
    allowedIntegrationTypes(principal, context.workspaceId),
    getBlockVisibility({
      ...(userId ? { userId } : {}),
      ...(context.workspaceOrganizationId ? { orgId: context.workspaceOrganizationId } : {}),
    }),
  ])
  const oauthServices = getAllOAuthServices().filter((service) => service.authType === 'oauth')
  const visibility = createIntegrationCredentialVisibility({
    allowedIntegrationTypes: allowedIntegrations,
    blockVisibility,
    oauthServices,
  })

  return oauthServices.map((service) => {
    const config = getServiceConfigByServiceId(service.serviceId)
    if (!config) {
      throw new Error(`OAuth service ${service.serviceId} is missing its canonical configuration`)
    }
    const providerIds = [service.providerId, ...(service.additionalProviderIds ?? [])]
    if (providerIds.length > 1 && !config.providerIdLabels) {
      throw new Error(`OAuth service ${service.serviceId} is missing provider option labels`)
    }
    const authorizationOptions = providerIds.map((providerId) => {
      const label = providerIds.length === 1 ? service.name : config.providerIdLabels?.[providerId]
      if (!label) {
        throw new Error(`OAuth provider ${providerId} is missing its authorization option label`)
      }
      return { providerId, label }
    })

    return {
      serviceId: service.serviceId,
      name: service.name,
      description: service.description,
      providerFamily: service.baseProvider,
      available: visibility.isOAuthServiceVisible(service),
      supportsReconnect: !['trello', 'shopify'].includes(service.providerId),
      authorizationOptions,
    }
  })
}

export function requireAvailableCredentialProvider(
  catalog: readonly CredentialProviderCatalogEntry[],
  providerId: string
): CredentialProviderCatalogEntry {
  const provider = catalog.find((entry) =>
    entry.authorizationOptions.some((option) => option.providerId === providerId)
  )
  if (!provider) {
    throw new OrchestrationError('validation', `Unknown OAuth provider: ${providerId}`)
  }
  if (!provider.available) {
    throw new OrchestrationError('conflict', `OAuth provider is unavailable: ${providerId}`)
  }
  return provider
}
