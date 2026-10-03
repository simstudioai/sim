import {
  getPreviewServiceAccountProviderId,
  type IntegrationAvailabilityState,
} from '@sim/deployment-config/integration-availability'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { getServiceAccountGatingBlockType } from '@/lib/credentials/service-account-provider-ids'
import { isHiddenUnder } from '@/blocks/visibility/context'

export type {
  IntegrationAvailability,
  IntegrationAvailabilityState,
} from '@sim/deployment-config/integration-availability'
/** Application compatibility surface for pure deployment availability helpers. */
export {
  getIntegrationTypesForOAuthServiceId,
  isDeploymentGatedIntegrationType,
  isOAuthServiceAllowedByIntegrationTypes,
  resolveIntegrationAvailability,
} from '@sim/deployment-config/integration-availability'

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
  const providerId = getPreviewServiceAccountProviderId(availability.type)
  const gatingBlockType = providerId ? getServiceAccountGatingBlockType(providerId) : null
  if (providerId && !gatingBlockType) {
    throw new Error(`Preview-gated service account ${providerId} has no gating block type`)
  }
  if (!gatingBlockType || isHiddenUnder(visibility, { type: gatingBlockType, preview: true })) {
    return availability.state
  }
  return availability.oauthAvailable ? 'ready' : 'limited'
}
