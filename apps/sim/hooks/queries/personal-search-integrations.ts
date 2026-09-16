'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectPersonalSearchIntegrationBody,
  connectPersonalSearchIntegrationContract,
  listPersonalSearchIntegrationsContract,
  type PersonalSearchIntegrationsQuery,
} from '@/lib/api/contracts/knowledge/personal-integrations'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

export const PERSONAL_SEARCH_INTEGRATIONS_STALE_TIME = 15_000
export const personalSearchIntegrationKeys = {
  all: ['personal-search-integrations'] as const,
  lists: () => [...personalSearchIntegrationKeys.all, 'list'] as const,
  list: (query: PersonalSearchIntegrationsQuery) =>
    [...personalSearchIntegrationKeys.lists(), query] as const,
}

export function usePersonalSearchIntegrations(
  query: PersonalSearchIntegrationsQuery,
  options: { pending?: boolean } = {}
) {
  return useQuery({
    queryKey: personalSearchIntegrationKeys.list(query),
    queryFn: async ({ signal }) =>
      (await requestJson(listPersonalSearchIntegrationsContract, { query, signal })).data,
    staleTime: PERSONAL_SEARCH_INTEGRATIONS_STALE_TIME,
    refetchInterval: options.pending ? 1_500 : false,
  })
}

export function useConnectPersonalSearchIntegration() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: ConnectPersonalSearchIntegrationBody) =>
      (await requestJson(connectPersonalSearchIntegrationContract, { body })).data,
    onSettled: (_data, _error, body) =>
      Promise.all([
        client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        client.invalidateQueries({
          queryKey: searchSourceKeys.list({
            kind: 'organization',
            organizationId: body.organizationId,
          }),
        }),
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(body.organizationId),
        }),
      ]),
  })
}
