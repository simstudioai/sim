import { MICROSOFT_DATAVERSE_PROVIDER_ID } from './microsoft-dataverse'
import { OAUTH_PROVIDERS } from './oauth'
import type {
  OAuthProvider,
  OAuthServiceConfig,
  OAuthServiceMetadata,
  ProviderConfig,
} from './types'

/**
 * Returns a flat list of all available OAuth services with metadata.
 * This is safe to use on the server as it doesn't include React components.
 */
export function getAllOAuthServices(): OAuthServiceMetadata[] {
  const services: OAuthServiceMetadata[] = []

  for (const [baseProviderId, provider] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(provider.services)) {
      services.push({
        serviceId,
        providerId: service.providerId,
        serviceAccountProviderId: service.serviceAccountProviderId,
        additionalProviderIds: service.additionalProviderIds,
        name: service.name,
        description: service.description,
        baseProvider: baseProviderId,
        authType: service.authType ?? 'oauth',
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

/**
 * Looks up the OAuth service registered under the given service id (the key in
 * a provider's `services` map). Returns `null` when no provider registers it.
 */
export function getServiceConfigByServiceId(serviceId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const service = provider.services[serviceId]
    if (service) return service
  }
  return null
}

export function getServiceConfigByProviderId(providerId: string): OAuthServiceConfig | null {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [key, service] of Object.entries(provider.services)) {
      // Also resolve a service-account provider id (e.g. `slack-custom-bot`) back
      // to its owning service so its credentials group under that integration.
      if (
        service.providerId === providerId ||
        key === providerId ||
        service.serviceAccountProviderId === providerId ||
        service.additionalProviderIds?.includes(providerId)
      ) {
        return service
      }
    }
  }

  return null
}

export function getServiceAccountProviderForProviderId(providerId: string): string | undefined {
  const serviceConfig = getServiceConfigByProviderId(providerId)
  return serviceConfig?.serviceAccountProviderId
}

/**
 * The two provider ids a service answers to. Structurally satisfied by both
 * `OAuthServiceConfig` and the lighter `OAuthServiceMatch` that catalog
 * resolution returns, so callers pass whichever they already hold.
 */
export interface ServiceProviderIdentity {
  providerId: string
  serviceAccountProviderId?: string
  additionalProviderIds?: readonly string[]
}

/**
 * Whether a stored credential's `providerId` authenticates the given service.
 *
 * A service is reachable by its own OAuth `providerId` (`jira`), the
 * service-account provider its family issues (`atlassian-service-account`),
 * and any `additionalProviderIds` naming a second authorization server for the
 * same service (`salesforce-sandbox`). One Atlassian API token authenticates
 * Jira, Jira Service Management, and Confluence alike, so matching on the
 * OAuth `providerId` alone hides a service-account credential from every
 * product page it actually powers — and a sandbox credential from the
 * Salesforce block entirely.
 *
 * Prefer this over comparing `getServiceConfigByProviderId(id)?.providerId`
 * against a service: that resolver walks `OAUTH_PROVIDERS` in declaration
 * order and answers "which service owns this id", which for a family-wide
 * service-account id is an arbitrary single winner — `atlassian-service-account`
 * resolves to the `Atlassian Service Account` pseudo-service and
 * `google-service-account` to whichever Google service is declared first.
 */
export function credentialProviderMatchesService(
  credentialProviderId: string,
  service: ServiceProviderIdentity
): boolean {
  return (
    service.providerId === credentialProviderId ||
    service.serviceAccountProviderId === credentialProviderId ||
    (service.additionalProviderIds?.includes(credentialProviderId) ?? false)
  )
}

/**
 * Every OAuth provider id whose credentials authenticate the service that
 * `providerId` names — the id itself plus any `additionalProviderIds`.
 *
 * The SQL counterpart to {@link credentialProviderMatchesService}: list
 * endpoints filter `account.providerId` / `credential.providerId` with
 * `inArray(...)` on this, so the query and the predicate can't disagree and
 * hide a credential the rest of the app considers usable.
 *
 * Widens only when `providerId` IS the service's primary OAuth id. Passing a
 * service-account id or an alternate server's id returns just that id, so a
 * query scoped to one credential family never broadens into another.
 */
export function providerIdsForService(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  if (!service || service.providerId !== providerId || !service.additionalProviderIds?.length) {
    return [providerId]
  }
  return [providerId, ...service.additionalProviderIds]
}

/**
 * Folds an alternate authorization server's provider id back onto the service
 * it belongs to (`salesforce-sandbox` → `salesforce`), leaving every other id
 * untouched. The inverse of {@link providerIdsForService}.
 *
 * Deliberately narrower than {@link credentialProviderMatchesService}: a
 * service-account id is shared by a whole family (one `google-service-account`
 * matches Gmail, Drive, Sheets…), so folding it onto the first matching
 * service would arbitrarily single out one product as connected.
 */
export function canonicalizeServiceProviderId(
  credentialProviderId: string,
  service: ServiceProviderIdentity | undefined
): string {
  return service?.additionalProviderIds?.includes(credentialProviderId)
    ? service.providerId
    : credentialProviderId
}

export function getCanonicalScopesForProvider(providerId: string): string[] {
  const service = getServiceConfigByProviderId(providerId)
  return service?.scopes ? [...service.scopes] : []
}

/**
 * Returns scopes that must be supplied on the link request instead of inherited from the static
 * Better Auth connector. Dataverse has both a legacy grant and an environment-specific grant;
 * leaving either on the connector makes Better Auth append it to the other resource audience.
 */
export function getPerRequestOAuthLinkScopes(providerId: string): string[] | undefined {
  return providerId === MICROSOFT_DATAVERSE_PROVIDER_ID
    ? getCanonicalScopesForProvider(providerId)
    : undefined
}

/**
 * Get canonical scopes for a service by its serviceId key in OAUTH_PROVIDERS.
 * Useful for block definitions to reference scopes from the single source of truth.
 */
export function getScopesForService(serviceId: string): string[] {
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    const service = provider.services[serviceId]
    if (service) {
      return [...service.scopes]
    }
  }
  return []
}

/**
 * Scopes that control token behavior but are not returned in OAuth token responses.
 * These should be ignored when validating credential scopes.
 */
const IGNORED_SCOPES = new Set([
  'offline_access', // Microsoft - requests refresh token
  'refresh_token', // Salesforce - requests refresh token
  'offline.access', // Airtable - requests refresh token (note: dot not underscore)
])

/**
 * Compute which of the provided requiredScopes are NOT granted by the credential.
 * Note: Ignores special OAuth scopes that control token behavior (like offline_access)
 * as they are not returned in the token response's scope list even when granted.
 */
export function getMissingRequiredScopes(
  credential: { scopes?: string[] } | undefined,
  requiredScopes: string[] = []
): string[] {
  if (!credential) {
    return requiredScopes.filter((s) => !IGNORED_SCOPES.has(s))
  }

  const granted = new Set(credential.scopes || [])
  const missing: string[] = []

  for (const s of requiredScopes) {
    if (IGNORED_SCOPES.has(s)) continue

    if (!granted.has(s) && !isScopeSatisfiedBy(s, granted)) missing.push(s)
  }

  return missing
}

/**
 * Whether a granted scope already covers `required` despite not matching it verbatim.
 *
 * A read-write scope subsumes its `.readonly` sibling — a credential holding
 * `.../auth/ediscovery` is accepted by every method that documents
 * `.../auth/ediscovery.readonly`. Without this, narrowing a consumer to the
 * least-privileged scope would report every already-connected credential as
 * missing it and prompt a re-consent that grants nothing new.
 *
 * This only derives a scope Sim actually requests. A consumer must never
 * require a scope absent from its provider's `scopes` array — no credential can
 * carry it, since that array is what the authorize request asks for.
 */
function isScopeSatisfiedBy(required: string, granted: ReadonlySet<string>): boolean {
  const readonlySuffix = '.readonly'
  if (!required.endsWith(readonlySuffix)) return false
  return granted.has(required.slice(0, -readonlySuffix.length))
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
    // Service-account credentials are stored under `serviceAccountProviderId`
    // (e.g. `claude-platform-service-account`). Map it to the same base so
    // icon/name resolution doesn't fall back to a mis-split base provider — the
    // hyphen split only recovers a single-segment base (`google`), not a
    // multi-segment one (`claude-platform`). First service to claim it wins.
    const saProviderId = service.serviceAccountProviderId
    if (saProviderId && !PROVIDER_ID_TO_BASE_PROVIDER[saProviderId]) {
      PROVIDER_ID_TO_BASE_PROVIDER[saProviderId] = {
        baseProvider: baseProviderId,
        serviceKey,
      }
    }
    // A second authorization server for the same service (`salesforce-sandbox`)
    // maps to the same base and service key, so its credentials resolve the
    // same icon and name. Without this the hyphen split would answer
    // `{ base: 'salesforce', feature: 'sandbox' }` — a service that does not
    // exist.
    for (const extraProviderId of service.additionalProviderIds ?? []) {
      if (!PROVIDER_ID_TO_BASE_PROVIDER[extraProviderId]) {
        PROVIDER_ID_TO_BASE_PROVIDER[extraProviderId] = {
          baseProvider: baseProviderId,
          serviceKey,
        }
      }
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
