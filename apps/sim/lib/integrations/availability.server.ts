import { env } from '@/lib/core/config/env'
import {
  resolveOAuthClientCapability,
  resolveOAuthClientCapabilityId,
} from '@/lib/core/config/env-capabilities'
import { resolveIntegrationAvailability } from '@/lib/integrations/availability'

export type {
  IntegrationAvailability,
  IntegrationAvailabilityState,
} from '@/lib/integrations/availability'

let unavailableIntegrationTypes: ReadonlySet<string> | null = null
const oauthServiceAvailability = new Map<string, boolean>()

export function getIntegrationAvailability() {
  return resolveIntegrationAvailability(env)
}

export function getUnavailableIntegrationTypes(): ReadonlySet<string> {
  if (!unavailableIntegrationTypes) {
    unavailableIntegrationTypes = new Set(
      getIntegrationAvailability()
        .filter(
          (integration) =>
            integration.state === 'unavailable' || integration.state === 'misconfigured'
        )
        .map((integration) => integration.type.toLowerCase())
    )
  }
  return unavailableIntegrationTypes
}

export function isIntegrationDeploymentAvailable(blockType: string): boolean {
  return !getUnavailableIntegrationTypes().has(blockType.toLowerCase())
}

export function isOAuthServiceDeploymentAvailable(serviceId: string): boolean {
  const normalized = serviceId.toLowerCase()
  const cached = oauthServiceAvailability.get(normalized)
  if (cached !== undefined) return cached
  const capabilityId = resolveOAuthClientCapabilityId(normalized)
  const available = capabilityId
    ? resolveOAuthClientCapability(capabilityId, env).state === 'ready'
    : true
  oauthServiceAvailability.set(normalized, available)
  return available
}
