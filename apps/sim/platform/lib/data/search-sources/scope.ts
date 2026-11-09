'use client'

import type { ResourceScope } from '@/lib/core/resource-scope'
import { useConnectorAvailability } from '@/platform/lib/data/knowledge/connectors/scope'
import { useOrganization } from '@/platform/lib/data/organization'

/**
 * Who may administer the organization's Search connections and which connection methods its
 * surface offers, read from the server-resolved organization the shell provides.
 */
export function useConnectorScope(scope: ResourceScope) {
  const { organization, viewer, searchAccess } = useOrganization()
  const own = scope.kind === 'organization' && scope.organizationId === organization.id
  return {
    scope,
    canAdmin: own && viewer.isAdmin,
    memberAccessAvailable: own && searchAccess.memberScoped,
    mirroredAccessAvailable: own && searchAccess.sourceMirrored,
    hasMaxAccess: false,
  }
}

/** The deployment's integration availability, named as the legacy Search setup reads it. */
export function useSearchAvailability() {
  const availability = useConnectorAvailability()
  return {
    integrationAvailability: availability.integrationAvailability,
    oauthServiceAvailability: availability.oauthServiceAvailability,
    isIntegrationAvailabilityReady: availability.isReady,
    isIntegrationAvailabilityLoading: availability.isLoading,
    isIntegrationAvailabilityFetching: availability.isFetching,
    integrationAvailabilityError: availability.error,
    refetchIntegrationAvailability: availability.refetch,
  }
}
