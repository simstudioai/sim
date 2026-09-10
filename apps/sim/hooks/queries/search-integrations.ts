import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listSearchIntegrationsContract,
  type UpdateSearchIntegrationBody,
  updateSearchIntegrationContract,
} from '@/lib/api/contracts/knowledge/search-integrations'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import { searchIntegrationKeys } from '@/hooks/queries/utils/search-integration-keys'

export const SEARCH_INTEGRATIONS_STALE_TIME = 30_000

export function useSearchIntegrations(organizationId: string) {
  return useQuery({
    queryKey: searchIntegrationKeys.list(organizationId),
    queryFn: async ({ signal }) =>
      (await requestJson(listSearchIntegrationsContract, { query: { organizationId }, signal }))
        .data,
    staleTime: SEARCH_INTEGRATIONS_STALE_TIME,
  })
}

export function useUpdateSearchIntegration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateSearchIntegrationBody) =>
      (await requestJson(updateSearchIntegrationContract, { body })).data,
    onSuccess: (_data, { organizationId }) =>
      Promise.all([
        resetOrganizationSearchAccess(queryClient, organizationId),
        queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.list(organizationId) }),
      ]),
  })
}
