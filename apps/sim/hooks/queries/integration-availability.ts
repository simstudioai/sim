import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'

export const integrationAvailabilityKeys = {
  all: ['allowedIntegrations'] as const,
  environments: () => [...integrationAvailabilityKeys.all, 'env'] as const,
}

export const INTEGRATION_AVAILABILITY_STALE_TIME = 5 * 60 * 1000

export function useIntegrationAvailability() {
  return useQuery({
    queryKey: integrationAvailabilityKeys.environments(),
    queryFn: ({ signal }) => requestJson(getAllowedIntegrationsContract, { signal }),
    staleTime: INTEGRATION_AVAILABILITY_STALE_TIME,
  })
}
