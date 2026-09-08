import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { SearchSourceSummary } from '@/lib/api/contracts/knowledge/connectors'
import {
  listSearchIntegrationsContract,
  type UpdateSearchIntegrationBody,
  updateSearchIntegrationContract,
} from '@/lib/api/contracts/knowledge/search-integrations'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { searchSourceKeys } from '@/hooks/queries/kb/connectors'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
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
    onSuccess: async (_data, { organizationId }) => {
      const scope = { kind: 'organization', organizationId } as const
      const sources = queryClient.getQueryData<SearchSourceSummary[]>(searchSourceKeys.list(scope))
      const knowledgeBaseIds = new Set(sources?.map((source) => source.knowledgeBaseId))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: searchIntegrationKeys.list(organizationId) }),
        queryClient.invalidateQueries({ queryKey: searchSourceKeys.list(scope) }),
        queryClient.resetQueries({
          queryKey: [...knowledgeKeys.searches(), resourceScopeKey(scope)],
        }),
        ...[...knowledgeBaseIds].map((id) =>
          queryClient.resetQueries({ queryKey: knowledgeKeys.detail(id) })
        ),
      ])
    },
  })
}
