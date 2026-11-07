'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectPersonalSearchIntegrationBody,
  connectPersonalSearchIntegrationContract,
  listPersonalSearchIntegrationsContract,
  type PersonalSearchIntegrationsQuery,
} from '@/lib/api/contracts/knowledge/personal-integrations'
import {
  type RemoveSearchPersonalCredentialBody,
  removeSearchPersonalCredentialContract,
  type SaveSearchPersonalCredentialBody,
  saveSearchPersonalCredentialContract,
} from '@/lib/api/contracts/search-personal-credentials'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
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
    mutationFn: async ({
      signal,
      ...body
    }: ConnectPersonalSearchIntegrationBody & { signal?: AbortSignal }) => {
      if (isDesktopApp()) {
        await connectDesktopSource({ kind: 'personal-search', body }, signal)
        return null
      }
      return (await requestJson(connectPersonalSearchIntegrationContract, { body, signal })).data
    },
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

/** Saves a member-owned provider credential and clears Search content fetched with prior access. */
export function useSavePersonalSearchCredential() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveSearchPersonalCredentialBody) =>
      requestJson(saveSearchPersonalCredentialContract, { body }),
    onSuccess: (_result, body) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(body.organizationId),
        }),
        client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        resetOrganizationSearchAccess(client, body.organizationId),
      ]),
  })
}

export function useRemovePersonalSearchCredential() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: RemoveSearchPersonalCredentialBody) =>
      requestJson(removeSearchPersonalCredentialContract, { body }),
    onSuccess: (_result, body) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(body.organizationId),
        }),
        client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        resetOrganizationSearchAccess(client, body.organizationId),
      ]),
  })
}
