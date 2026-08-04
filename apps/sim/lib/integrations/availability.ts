import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import type { EnvCapabilityValues } from '@/lib/core/config/env-capabilities'
import {
  inspectOAuthClientCapability,
  resolveOAuthClientCapabilityId,
} from '@/lib/core/config/env-capabilities'
import { getServiceAccountGatingBlockType } from '@/lib/credentials/service-account-provider-ids'
import integrationsJson from '@/lib/integrations/integrations.json'
import { getServiceAccountMetadata } from '@/lib/integrations/service-account-metadata'
import { isHiddenUnder } from '@/blocks/visibility/context'

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
const previewServiceAccountGatesByIntegrationType = new Map<string, string>()
for (const integration of integrations) {
  if (integration.authType !== 'oauth' || !integration.oauthServiceId) continue
  const serviceId = integration.oauthServiceId.toLowerCase()
  const current = integrationTypesByOAuthServiceId.get(serviceId) ?? []
  const integrationType = integration.type.toLowerCase()
  integrationTypesByOAuthServiceId.set(serviceId, [...current, integrationType])

  const serviceAccount = getServiceAccountMetadata(serviceId)
  if (serviceAccount?.deploymentRequirement !== 'preview-gated') continue
  const gatingBlockType = getServiceAccountGatingBlockType(serviceAccount.providerId)
  if (!gatingBlockType) {
    throw new Error(
      `Preview-gated service account ${serviceAccount.providerId} has no gating block type`
    )
  }
  previewServiceAccountGatesByIntegrationType.set(integrationType, gatingBlockType)
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

interface IntegrationAvailabilitySummary {
  type: string
  state: IntegrationAvailabilityState
  oauthAvailable: boolean
}

/**
 * Projects deployment availability through the current viewer's block gate.
 * A revealed preview service-account path makes an OAuth-unavailable
 * integration limited rather than unavailable; the OAuth path itself remains
 * disabled. The shared hidden predicate keeps preview and kill-switch behavior
 * identical to every other block discovery surface.
 */
export function resolveIntegrationAvailabilityStateForVisibility(
  availability: IntegrationAvailabilitySummary,
  visibility: BlockVisibilityState | null
): IntegrationAvailabilityState {
  const gatingBlockType = previewServiceAccountGatesByIntegrationType.get(
    availability.type.toLowerCase()
  )
  if (!gatingBlockType || isHiddenUnder(visibility, { type: gatingBlockType, preview: true })) {
    return availability.state
  }
  return availability.oauthAvailable ? 'ready' : 'limited'
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
