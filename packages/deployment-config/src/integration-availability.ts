import type { EnvCapabilityValues } from './env-capabilities'
import { inspectOAuthClientCapability, resolveOAuthClientCapabilityId } from './env-capabilities'
import integrationsJson from './integrations.json'
import { getServiceAccountMetadata } from './service-account-metadata'
import { CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS } from './service-account-providers.generated'

export type IntegrationAvailabilityState = 'ready' | 'limited' | 'unavailable' | 'misconfigured'

export interface IntegrationAvailability {
  type: string
  slug: string
  name: string
  state: IntegrationAvailabilityState
  oauthAvailable: boolean
  serviceAccountAvailable: boolean
  missingFields: readonly string[]
  setupCommand?: string
}

interface DeploymentIntegration {
  type: string
  slug: string
  name: string
  authType: 'oauth' | 'api-key' | 'none'
  oauthServiceId?: string
  serviceAccountServiceId?: string
}

const integrations = integrationsJson.integrations as readonly DeploymentIntegration[]
const credentialConfiguredOAuthServiceIds = new Set<string>(CREDENTIAL_CONFIGURED_OAUTH_SERVICE_IDS)
const deploymentGatedIntegrationTypes = new Set(
  integrations
    .filter(
      (integration) => integration.authType === 'oauth' || integration.serviceAccountServiceId
    )
    .map((integration) => integration.type.toLowerCase())
)
const integrationTypesByOAuthServiceId = new Map<string, readonly string[]>()
/** Search authorization shares GitHub's integration policy while its workflow tools retain PAT auth. */
integrationTypesByOAuthServiceId.set('github-repositories', ['github_v2'])
const previewServiceAccountProvidersByIntegrationType = new Map<string, string>()
for (const integration of integrations) {
  const credentialServiceId = integration.serviceAccountServiceId ?? integration.oauthServiceId
  if (!credentialServiceId) continue
  const serviceId = credentialServiceId.toLowerCase()
  const current = integrationTypesByOAuthServiceId.get(serviceId) ?? []
  const integrationType = integration.type.toLowerCase()
  integrationTypesByOAuthServiceId.set(serviceId, [...current, integrationType])

  const serviceAccount = getServiceAccountMetadata(serviceId)
  if (serviceAccount?.deploymentRequirement !== 'preview-gated') continue
  previewServiceAccountProvidersByIntegrationType.set(integrationType, serviceAccount.providerId)
}

export function isDeploymentGatedIntegrationType(blockType: string): boolean {
  return deploymentGatedIntegrationTypes.has(blockType.toLowerCase())
}

/** Returns block types using a canonical credential service, including stored service accounts. */
export function getIntegrationTypesForOAuthServiceId(serviceId: string): readonly string[] {
  return integrationTypesByOAuthServiceId.get(serviceId.toLowerCase()) ?? []
}

/** Applies an integration allowlist to an OAuth service without loading executable registries. */
export function isOAuthServiceAllowedByIntegrationTypes(
  serviceId: string,
  allowedIntegrationTypes: ReadonlySet<string> | null
): boolean {
  if (allowedIntegrationTypes === null) return true
  const integrationTypes = getIntegrationTypesForOAuthServiceId(serviceId)
  return (
    integrationTypes.length === 0 ||
    integrationTypes.some((blockType) => allowedIntegrationTypes.has(blockType))
  )
}

/** Returns the preview-gated service-account provider for an integration type. */
export function getPreviewServiceAccountProviderId(integrationType: string): string | undefined {
  return previewServiceAccountProvidersByIntegrationType.get(integrationType.toLowerCase())
}

function resolveOAuthIntegrationAvailability(
  integration: DeploymentIntegration,
  values: EnvCapabilityValues
): IntegrationAvailability {
  const { oauthServiceId } = integration
  if (!oauthServiceId) {
    throw new Error(`OAuth integration ${integration.slug} is missing oauthServiceId`)
  }

  const capabilityId = resolveOAuthClientCapabilityId(oauthServiceId)
  const serviceAccount = getServiceAccountMetadata(oauthServiceId)

  if (!capabilityId) {
    if (credentialConfiguredOAuthServiceIds.has(oauthServiceId)) {
      return {
        type: integration.type,
        slug: integration.slug,
        name: integration.name,
        state: 'ready',
        oauthAvailable: true,
        serviceAccountAvailable: false,
        missingFields: [],
      }
    }
    throw new Error(
      `OAuth integration ${integration.slug} has no OAuth client capability definition`
    )
  }

  const oauth = inspectOAuthClientCapability(capabilityId, values)
  const setupCommand = `npx sim-setup add integration ${capabilityId}`
  const serviceAccountAvailable = Boolean(
    serviceAccount &&
      serviceAccount.deploymentRequirement !== 'preview-gated' &&
      (serviceAccount.deploymentRequirement !== 'oauth-client' || oauth.state === 'ready')
  )
  const state: IntegrationAvailabilityState =
    oauth.state === 'ready'
      ? 'ready'
      : serviceAccountAvailable
        ? 'limited'
        : oauth.state === 'partial' || oauth.state === 'invalid'
          ? 'misconfigured'
          : 'unavailable'

  return {
    type: integration.type,
    slug: integration.slug,
    name: integration.name,
    state,
    oauthAvailable: oauth.state === 'ready',
    serviceAccountAvailable,
    missingFields: oauth.missingFields,
    setupCommand,
  }
}

/**
 * Resolves deployment availability for every integration in the generated
 * catalog using only caller-supplied environment values and pure metadata.
 */
export function resolveIntegrationAvailability(
  values: EnvCapabilityValues
): readonly IntegrationAvailability[] {
  return integrations.map((integration) => {
    if (integration.authType === 'oauth') {
      return resolveOAuthIntegrationAvailability(integration, values)
    }

    if (integration.serviceAccountServiceId) {
      const serviceAccount = getServiceAccountMetadata(integration.serviceAccountServiceId)
      if (!serviceAccount) {
        throw new Error(`Integration ${integration.slug} is missing service-account metadata`)
      }
      const capabilityId = resolveOAuthClientCapabilityId(integration.serviceAccountServiceId)
      const serviceAccountAvailable =
        serviceAccount.deploymentRequirement !== 'preview-gated' &&
        (serviceAccount.deploymentRequirement !== 'oauth-client' ||
          Boolean(
            capabilityId && inspectOAuthClientCapability(capabilityId, values).state === 'ready'
          ))
      return {
        type: integration.type,
        slug: integration.slug,
        name: integration.name,
        state: serviceAccountAvailable ? 'ready' : 'unavailable',
        oauthAvailable: false,
        serviceAccountAvailable,
        missingFields: [],
      }
    }

    return {
      type: integration.type,
      slug: integration.slug,
      name: integration.name,
      state: 'ready',
      oauthAvailable: false,
      serviceAccountAvailable: false,
      missingFields: [],
    }
  })
}
