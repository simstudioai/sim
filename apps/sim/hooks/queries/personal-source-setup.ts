'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listPersonalSourceSetupAccountsContract,
  type PersonalSourceSetupBody,
  type PersonalSourceSetupQuery,
  personalSourceSetupContract,
} from '@/lib/api/contracts/knowledge/personal-source-setup'
import { memberConnectorKeys } from '@/hooks/queries/kb/connectors'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { personalSearchIntegrationKeys } from '@/hooks/queries/personal-search-integrations'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

export const PERSONAL_SOURCE_SETUP_STALE_TIME = 15_000

export const personalSourceSetupKeys = {
  all: ['personal-source-setup'] as const,
  lists: () => [...personalSourceSetupKeys.all, 'list'] as const,
  list: (query: PersonalSourceSetupQuery) => [...personalSourceSetupKeys.lists(), query] as const,
}

export function usePersonalSourceSetupAccounts(query: PersonalSourceSetupQuery) {
  return useQuery({
    queryKey: personalSourceSetupKeys.list(query),
    queryFn: async ({ signal }) =>
      (await requestJson(listPersonalSourceSetupAccountsContract, { query, signal })).data,
    staleTime: PERSONAL_SOURCE_SETUP_STALE_TIME,
    refetchInterval: (state) =>
      query.completionId && !state.state.data?.completedCredentialId ? 1_500 : false,
  })
}

export function useAuthorizePersonalSourceSetup() {
  return useMutation({
    mutationFn: async (body: Extract<PersonalSourceSetupBody, { action: 'authorize' }>) => {
      const { data } = await requestJson(personalSourceSetupContract, { body })
      if (data.kind !== 'authorization') throw new Error('Could not start account authorization')
      return data
    },
  })
}

export function useConnectPersonalSourceSetup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: Extract<PersonalSourceSetupBody, { action: 'connect' }>) => {
      const { data } = await requestJson(personalSourceSetupContract, { body })
      if (data.kind !== 'connected') throw new Error('Could not connect the source')
      return data
    },
    onSuccess: (_data, body) =>
      Promise.all([
        client.invalidateQueries({ queryKey: personalSourceSetupKeys.lists() }),
        client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        client.invalidateQueries({ queryKey: memberConnectorKeys.lists() }),
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
