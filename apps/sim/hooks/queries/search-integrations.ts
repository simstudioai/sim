import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import {
  listSearchIntegrationsContract,
  type UpdateSearchIntegrationBody,
  updateSearchIntegrationContract,
} from '@/lib/api/contracts/knowledge/search-integrations'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import {
  SEARCH_INTEGRATIONS_STALE_TIME,
  searchIntegrationKeys,
} from '@/hooks/queries/utils/search-integration-keys'

function searchIntegrationsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: searchIntegrationKeys.list(organizationId),
    queryFn: async ({ signal }) =>
      (await requestJson(listSearchIntegrationsContract, { query: { organizationId }, signal }))
        .data,
    staleTime: SEARCH_INTEGRATIONS_STALE_TIME,
  })
}

export function useSearchIntegrations(organizationId: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...searchIntegrationsQueryOptions(organizationId),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
  })
}

export function useUpdateSearchIntegration() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: async (body: UpdateSearchIntegrationBody) =>
      (await requestJson(updateSearchIntegrationContract, { body })).data,
    onSuccess: async (_data, { organizationId }) => {
      await Promise.all([
        resetOrganizationSearchAccess(queryClient, organizationId),
        queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.list(organizationId) }),
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
      ])
      router.refresh()
    },
  })
}
