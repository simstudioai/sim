'use client'

import type { OrganizationNetwork } from '@/lib/api/contracts/organization-network'
import { useOrganizationNetwork } from '@/hooks/queries/organization-network'

function outboundAddresses(network: OrganizationNetwork) {
  if (network.mode === 'unavailable') return { kind: 'unavailable' as const }
  if (network.mode === 'gateway' && network.publicIps.length > 0) {
    return { kind: 'allowlist' as const, publicIps: network.publicIps }
  }
  return {
    kind: 'none' as const,
    message:
      network.mode === 'blocked'
        ? 'Supported HTTPS connections are paused.'
        : network.mode === 'gateway'
          ? 'Your outbound IP addresses aren’t available yet.'
          : 'Outbound IP addresses are not configured for this organization.',
  }
}

/**
 * The organization's outbound traffic as the section words it: the addresses to allowlist, why there
 * are none, or that the deployment could not say.
 */
export function useOutboundAddresses(organizationId: string) {
  const { data, error, isFetching, refetch } = useOrganizationNetwork(organizationId)
  return { data: data && outboundAddresses(data), error, isFetching, refetch }
}
