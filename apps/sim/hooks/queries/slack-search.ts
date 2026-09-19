'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConfigureSlackSearchBody,
  type ConnectCustomSlackSearchBody,
  configureSlackSearchContract,
  connectCustomSlackSearchContract,
  listSlackSearchContract,
  prepareSlackSearchContract,
  removeSlackSearchContract,
  type StartSlackSearchOAuthBody,
  startSlackSearchOAuthContract,
} from '@/lib/api/contracts/knowledge/slack'
import {
  SLACK_SEARCH_DEFAULT_DESCRIPTION,
  SLACK_SEARCH_DEFAULT_NAME,
} from '@/lib/slack-search/manifest'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

export const SLACK_SEARCH_STALE_TIME = 30_000

export function useSlackSearchManifest(organizationId: string, name = SLACK_SEARCH_DEFAULT_NAME) {
  return useQuery({
    queryKey: slackSearchKeys.manifest(organizationId, name),
    queryFn: ({ signal }) =>
      requestJson(prepareSlackSearchContract, {
        body: { organizationId, name, description: SLACK_SEARCH_DEFAULT_DESCRIPTION },
        signal,
      }),
    staleTime: SLACK_SEARCH_STALE_TIME,
    retry: false,
  })
}

export function useStartSlackSearchOAuth() {
  return useMutation({
    mutationFn: (body: StartSlackSearchOAuthBody) =>
      requestJson(startSlackSearchOAuthContract, { body }),
  })
}

export function useConnectCustomSlackSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ConnectCustomSlackSearchBody) =>
      requestJson(connectCustomSlackSearchContract, { body }),
    onSuccess: async (_result, input) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: slackSearchKeys.list(input.organizationId) }),
        client.invalidateQueries({
          queryKey: slackSearchKeys.organizationManifests(input.organizationId),
        }),
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(input.organizationId),
        }),
      ])
    },
  })
}

export function useSlackSearchInstallations(organizationId?: string) {
  return useQuery({
    queryKey: slackSearchKeys.list(organizationId),
    queryFn: ({ signal }) => {
      if (!organizationId) throw new Error('Organization is required')
      return requestJson(listSlackSearchContract, { query: { organizationId }, signal })
    },
    enabled: Boolean(organizationId),
    staleTime: SLACK_SEARCH_STALE_TIME,
  })
}

export function useConfigureSlackSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ConfigureSlackSearchBody) =>
      requestJson(configureSlackSearchContract, { body }),
    onSuccess: (_result, input) =>
      client.invalidateQueries({ queryKey: slackSearchKeys.list(input.organizationId) }),
  })
}

export function useRemoveSlackSearch() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      installationId,
    }: {
      organizationId: string
      installationId: string
    }) =>
      requestJson(removeSlackSearchContract, {
        params: { installationId },
        query: { organizationId },
      }),
    onSuccess: (_result, input) =>
      client.invalidateQueries({ queryKey: slackSearchKeys.list(input.organizationId) }),
  })
}
