import { stripVersionSuffix } from '@sim/utils/string'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { env } from '@/lib/core/config/env'
import {
  inspectOAuthClientCapability,
  resolveOAuthClientCapabilityId,
} from '@/lib/core/config/env-capabilities'
import {
  type IntegrationAvailability,
  resolveIntegrationAvailability,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import type { OAuthServiceMetadata } from '@/lib/oauth/types'

export type {
  IntegrationAvailability,
  IntegrationAvailabilityState,
} from '@/lib/integrations/availability'

let integrationAvailabilityByType: ReadonlyMap<string, IntegrationAvailability> | null = null
const oauthServiceAvailability = new Map<string, boolean>()

export function getIntegrationAvailability() {
  return resolveIntegrationAvailability(env)
}

/** OAuth clients are independent of the authentication method a workflow block exposes. */
export function getOAuthServiceAvailability(
  services: readonly Pick<OAuthServiceMetadata, 'providerId' | 'authType'>[]
): { providerId: string; available: boolean }[] {
  return services
    .filter((service) => service.authType === 'oauth')
    .map((service) => ({
      providerId: service.providerId,
      available: isOAuthServiceDeploymentAvailable(service.providerId),
    }))
}

function getIntegrationAvailabilityByType(): ReadonlyMap<string, IntegrationAvailability> {
  if (!integrationAvailabilityByType) {
    integrationAvailabilityByType = new Map(
      getIntegrationAvailability().map((availability) => [
        availability.type.toLowerCase(),
        availability,
      ])
    )
  }
  return integrationAvailabilityByType
}

function getIntegrationAvailabilityForBlockType(
  blockType: string
): IntegrationAvailability | undefined {
  const normalized = blockType.toLowerCase().replace(/-/g, '_')
  const availabilityByType = getIntegrationAvailabilityByType()
  return (
    availabilityByType.get(normalized) ?? availabilityByType.get(stripVersionSuffix(normalized))
  )
}

export function isIntegrationDeploymentAvailable(blockType: string): boolean {
  const availability = getIntegrationAvailabilityForBlockType(blockType)
  return (
    !availability ||
    (availability.state !== 'unavailable' && availability.state !== 'misconfigured')
  )
}

/**
 * Whether an integration can be used in this deployment for the current
 * viewer. The cached catalog remains viewer-agnostic; preview service-account
 * alternatives are projected against explicitly supplied block visibility.
 */
export function isIntegrationDeploymentAvailableForVisibility(
  blockType: string,
  visibility: BlockVisibilityState | null
): boolean {
  const availability = getIntegrationAvailabilityForBlockType(blockType)
  if (!availability) return true
  const state = resolveIntegrationAvailabilityStateForVisibility(availability, visibility)
  return state !== 'unavailable' && state !== 'misconfigured'
}

export function isOAuthServiceDeploymentAvailable(serviceId: string): boolean {
  const normalized = serviceId.toLowerCase()
  const cached = oauthServiceAvailability.get(normalized)
  if (cached !== undefined) return cached
  const capabilityId = resolveOAuthClientCapabilityId(normalized)
  const available = capabilityId
    ? inspectOAuthClientCapability(capabilityId, env).state === 'ready'
    : true
  oauthServiceAvailability.set(normalized, available)
  return available
}
