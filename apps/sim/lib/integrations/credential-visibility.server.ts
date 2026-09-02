import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { getServiceAccountGatingBlockType } from '@/lib/credentials/service-account-provider-ids'
import {
  getIntegrationTypesForOAuthServiceId,
  isOAuthServiceAllowedByIntegrationTypes,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import {
  getIntegrationAvailability,
  isOAuthServiceDeploymentAvailable,
} from '@/lib/integrations/availability.server'
import type { OAuthServiceMetadata } from '@/lib/oauth/types'
import { getAllOAuthServices } from '@/lib/oauth/utils'
import { getBlock } from '@/blocks/registry'
import { isHiddenUnder } from '@/blocks/visibility/context'

export interface IntegrationCredentialIdentity {
  providerId: string
  type?: 'oauth' | 'service_account' | 'managed_oauth'
}

interface IntegrationCredentialVisibilityOptions {
  allowedIntegrationTypes: ReadonlySet<string> | null
  blockVisibility: BlockVisibilityState | null
  oauthServices?: readonly OAuthServiceMetadata[]
}

export interface IntegrationCredentialVisibility {
  isCredentialVisible: (credential: IntegrationCredentialIdentity) => boolean
  isOAuthServiceVisible: (service: OAuthServiceMetadata) => boolean
}

/**
 * Builds the server-side projection shared by Copilot credential discovery and
 * the workspace VFS. Unknown provider ids are not integration credentials and
 * remain visible; mapped OAuth and service-account ids must have at least one
 * owning integration that is allowed, deployment-ready, and visible to the
 * current block-visibility projection.
 */
export function createIntegrationCredentialVisibility({
  allowedIntegrationTypes,
  blockVisibility,
  oauthServices = getAllOAuthServices(),
}: IntegrationCredentialVisibilityOptions): IntegrationCredentialVisibility {
  const oauthOwners = oauthServices.filter((service) => service.authType === 'oauth')
  const oauthOwnersByProviderId = new Map<string, OAuthServiceMetadata[]>()
  const serviceAccountOwnersByProviderId = new Map<string, OAuthServiceMetadata[]>()
  const availabilityByType = new Map(
    getIntegrationAvailability().map((availability) => [
      availability.type.toLowerCase(),
      availability,
    ])
  )

  const addOwner = (
    ownersByProviderId: Map<string, OAuthServiceMetadata[]>,
    providerId: string,
    service: OAuthServiceMetadata
  ) => {
    const owners = ownersByProviderId.get(providerId)
    if (owners) owners.push(service)
    else ownersByProviderId.set(providerId, [service])
  }

  for (const service of oauthServices) {
    if (service.authType === 'oauth') {
      addOwner(oauthOwnersByProviderId, service.providerId, service)
      // A second authorization server for the same service (`salesforce-sandbox`)
      // issues ordinary OAuth credentials, so they own visibility exactly like
      // the primary provider's do.
      for (const extraProviderId of service.additionalProviderIds ?? []) {
        addOwner(oauthOwnersByProviderId, extraProviderId, service)
      }
    }
    const serviceAccountProviderId =
      service.serviceAccountProviderId ??
      (service.authType === 'service_account' ? service.providerId : undefined)
    if (serviceAccountProviderId) {
      addOwner(serviceAccountOwnersByProviderId, serviceAccountProviderId, service)
    }
  }

  const isServiceAllowed = (service: OAuthServiceMetadata) =>
    isOAuthServiceAllowedByIntegrationTypes(service.serviceId, allowedIntegrationTypes)

  const visibleAvailability = (service: OAuthServiceMetadata) => {
    return getIntegrationTypesForOAuthServiceId(service.serviceId).flatMap((blockType) => {
      const block = getBlock(blockType)
      if (!block || block.hideFromToolbar || isHiddenUnder(blockVisibility, block)) return []
      const availability = availabilityByType.get(blockType.toLowerCase())
      return availability ? [availability] : []
    })
  }

  const isOAuthServiceVisible = (service: OAuthServiceMetadata): boolean => {
    if (service.authType !== 'oauth' || !isServiceAllowed(service)) return false
    const integrationTypes = getIntegrationTypesForOAuthServiceId(service.serviceId)
    if (integrationTypes.length === 0) {
      return isOAuthServiceDeploymentAvailable(service.providerId)
    }
    return visibleAvailability(service).some(
      (availability) => availability.state === 'ready' && availability.oauthAvailable
    )
  }

  const isServiceAccountVisible = (
    providerId: string,
    owners: readonly OAuthServiceMetadata[]
  ): boolean => {
    const gatingBlockType = getServiceAccountGatingBlockType(providerId)
    if (gatingBlockType) {
      const gatingBlock = getBlock(gatingBlockType)
      if (!gatingBlock || isHiddenUnder(blockVisibility, gatingBlock)) return false
      return owners.some(
        (service) =>
          isServiceAllowed(service) &&
          visibleAvailability(service).some((availability) => {
            const state = resolveIntegrationAvailabilityStateForVisibility(
              availability,
              blockVisibility
            )
            return state === 'ready' || state === 'limited'
          })
      )
    }

    return owners.some(
      (service) =>
        isServiceAllowed(service) &&
        visibleAvailability(service).some(
          (availability) =>
            availability.serviceAccountAvailable &&
            (availability.state === 'ready' || availability.state === 'limited')
        )
    )
  }

  const isCredentialVisible = ({ providerId, type }: IntegrationCredentialIdentity): boolean => {
    if (type !== 'service_account') {
      const owners = oauthOwnersByProviderId.get(providerId)
      if (owners) return owners.some(isOAuthServiceVisible)
    }

    if (type !== 'oauth') {
      const owners = serviceAccountOwnersByProviderId.get(providerId)
      if (owners) return isServiceAccountVisible(providerId, owners)
    }

    return true
  }

  return { isCredentialVisible, isOAuthServiceVisible }
}
