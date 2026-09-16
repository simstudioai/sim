import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getOrganizationNetworkContract } from '@/lib/api/contracts/organization-network'

export const ORGANIZATION_NETWORK_STALE_TIME = 30_000

export const organizationNetworkKeys = {
  all: ['organization-network'] as const,
  details: () => [...organizationNetworkKeys.all, 'detail'] as const,
  detail: (organizationId: string) =>
    [...organizationNetworkKeys.details(), organizationId] as const,
}

export function useOrganizationNetwork(organizationId: string) {
  return useQuery({
    queryKey: organizationNetworkKeys.detail(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationNetworkContract, { params: { id: organizationId }, signal }),
    enabled: Boolean(organizationId),
    staleTime: ORGANIZATION_NETWORK_STALE_TIME,
  })
}
