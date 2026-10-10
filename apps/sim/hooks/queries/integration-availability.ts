import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import {
  INTEGRATION_AVAILABILITY_STALE_TIME,
  integrationAvailabilityKeys,
} from '@/hooks/queries/utils/integration-availability-keys'

export function useIntegrationAvailability() {
  return useQuery({
    queryKey: integrationAvailabilityKeys.environments(),
    queryFn: ({ signal }) => requestJson(getAllowedIntegrationsContract, { signal }),
    staleTime: INTEGRATION_AVAILABILITY_STALE_TIME,
  })
}
