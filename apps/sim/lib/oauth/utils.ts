import { OAUTH_PROVIDERS } from './oauth'
import type {
  OAuthProvider,
  OAuthServiceConfig,
  OAuthServiceMetadata,
  ProviderConfig,
  ScopeEvaluation,
} from './types'

/**
 * Returns a flat list of all available OAuth services with metadata.
 * This is safe to use on the server as it doesn't include React components.
 */
export function getAllOAuthServices(): OAuthServiceMetadata[] {
  const services: OAuthServiceMetadata[] = []

  for (const [baseProviderId, provider] of Object.entries(OAUTH_PROVIDERS)) {
    for (const service of Object.values(provider.services)) {
      services.push({
        providerId: service.providerId,
        name: service.name,
        description: service.description,
        baseProvider: baseProviderId,
      })
    }
  }

  return services
}

export function getServiceByProviderAndId(
  provider: OAuthProvider,
  serviceId?: string
): OAuthServiceConfig {
  const providerConfig = OAUTH_PROVIDERS[provider]
  if (!providerConfig) {
    throw new Error(`Provider ${provider} not found`)
  }

  if (!serviceId) {
    return providerConfig.services[providerConfig.defaultService]
  }

  return (
    providerConfig.services[serviceId] || providerConfig.services[providerConfig.defaultService]
  )
}

export function getProviderIdFromServiceId(serviceId: string): string {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [id, service] of Object.entries(provider.services)) {
      if (id === serviceId) {
        return service.providerId
      }
    }
  }

  // Default fallback
  return serviceId
}

export function getServiceConfigByProviderId(providerId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [key, service] of Object.entries(provider.services)) {
      if (service.providerId === providerId || key === providerId) {
        return service
      }
    }
  }

  return null
}

export function getCanonicalScopesForProvider(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  return service?.scopes ? [...service.scopes] : []
}

export function normalizeScopes(scopes: string[]): string[] {
  const seen = new Set<string>()
  for (const scope of scopes) {
    const trimmed = scope.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
    }
  }
  return Array.from(seen)
}

export function evaluateScopeCoverage(
  providerId: string,
  grantedScopes: string[]
): ScopeEvaluation {
  const canonicalScopes = getCanonicalScopesForProvider(providerId)
  const normalizedGranted = normalizeScopes(grantedScopes)

  const canonicalSet = new Set(canonicalScopes)
  const grantedSet = new Set(normalizedGranted)

  const missingScopes = canonicalScopes.filter((scope) => !grantedSet.has(scope))
  const extraScopes = normalizedGranted.filter((scope) => !canonicalSet.has(scope))

  return {
    canonicalScopes,
    grantedScopes: normalizedGranted,
    missingScopes,
    extraScopes,
    requiresReauthorization: missingScopes.length > 0,
  }
}

/**
 * Build a mapping of providerId -> { baseProvider, serviceKey } from OAUTH_PROVIDERS
 * This is computed once at module load time
 */
const PROVIDER_ID_TO_BASE_PROVIDER: Record<string, { baseProvider: string; serviceKey: string }> =
  {}

for (const [baseProviderId, providerConfig] of Object.entries(OAUTH_PROVIDERS)) {
  for (const [serviceKey, service] of Object.entries(providerConfig.services)) {
    PROVIDER_ID_TO_BASE_PROVIDER[service.providerId] = {
      baseProvider: baseProviderId,
      serviceKey,
    }
  }
}

/**
 * Parse a provider string into its base provider and feature type.
 * Uses the pre-computed mapping from OAUTH_PROVIDERS for accuracy.
 */
export function parseProvider(provider: OAuthProvider): ProviderConfig {
  // First, check if this is a known providerId from our config
  const mapping = PROVIDER_ID_TO_BASE_PROVIDER[provider]
  if (mapping) {
    return {
      baseProvider: mapping.baseProvider,
      featureType: mapping.serviceKey,
    }
  }

  // Handle compound providers (e.g., 'google-email' -> { baseProvider: 'google', featureType: 'email' })
  const [base, feature] = provider.split('-')

  if (feature) {
    return {
      baseProvider: base,
      featureType: feature,
    }
  }

  // For simple providers, use 'default' as feature type
  return {
    baseProvider: provider,
    featureType: 'default',
  }
}
