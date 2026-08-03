import type { EnvCapabilityValues } from '@/lib/core/config/env-capabilities'
import {
  inspectOAuthClientCapability,
  resolveOAuthClientCapabilityId,
} from '@/lib/core/config/env-capabilities'
import integrationsJson from '@/lib/integrations/integrations.json'
import { getServiceAccountMetadata } from '@/lib/integrations/service-account-metadata'

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
}

const integrations = integrationsJson.integrations as readonly DeploymentIntegration[]
const deploymentGatedIntegrationTypes = new Set(
  integrations
    .filter((integration) => integration.authType === 'oauth')
    .map((integration) => integration.type.toLowerCase())
)
const integrationTypesByOAuthServiceId = new Map<string, readonly string[]>()
for (const integration of integrations) {
  if (integration.authType !== 'oauth' || !integration.oauthServiceId) continue
  const serviceId = integration.oauthServiceId.toLowerCase()
  const current = integrationTypesByOAuthServiceId.get(serviceId) ?? []
  integrationTypesByOAuthServiceId.set(serviceId, [...current, integration.type.toLowerCase()])
}

export function isDeploymentGatedIntegrationType(blockType: string): boolean {
  return deploymentGatedIntegrationTypes.has(blockType.toLowerCase())
}

/** Returns the generated integration block types authenticated by one OAuth service entry. */
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
    throw new Error(
      `OAuth integration ${integration.slug} has no OAuth client capability definition`
    )
  }

  const oauth = inspectOAuthClientCapability(capabilityId, values)
  const setupCommand = `bun run setup integration ${capabilityId}`
  const serviceAccountAvailable = Boolean(
    serviceAccount &&
      serviceAccount.deploymentRequirement !== 'preview-gated' &&
      (serviceAccount.deploymentRequirement !== 'oauth-client' || oauth.state === 'ready')
  )
  const state: IntegrationAvailabilityState =
    oauth.state === 'ready'
      ? 'ready'
      : oauth.state === 'partial' || oauth.state === 'invalid'
        ? 'misconfigured'
        : serviceAccountAvailable
          ? 'limited'
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
