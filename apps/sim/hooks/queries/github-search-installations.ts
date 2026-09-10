'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectGitHubSearchInstallationBody,
  connectGitHubSearchInstallationContract,
  listGitHubSearchInstallationsContract,
} from '@/lib/api/contracts/knowledge/github-installations'
import { oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'

export const GITHUB_SEARCH_INSTALLATIONS_STALE_TIME = 30_000

export const githubSearchInstallationKeys = {
  all: ['github-search-installations'] as const,
  lists: () => [...githubSearchInstallationKeys.all, 'list'] as const,
  list: (organizationId?: string) =>
    [...githubSearchInstallationKeys.lists(), organizationId ?? ''] as const,
}

export function useGitHubSearchInstallations(organizationId?: string) {
  return useQuery({
    queryKey: githubSearchInstallationKeys.list(organizationId),
    queryFn: ({ signal }) => {
      if (!organizationId) throw new Error('Organization is required')
      return requestJson(listGitHubSearchInstallationsContract, {
        query: { organizationId },
        signal,
      })
    },
    enabled: Boolean(organizationId),
    staleTime: GITHUB_SEARCH_INSTALLATIONS_STALE_TIME,
    refetchOnWindowFocus: 'always',
    retry: false,
  })
}

export function useConnectGitHubSearchInstallation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ConnectGitHubSearchInstallationBody) =>
      requestJson(connectGitHubSearchInstallationContract, { body }),
    onSuccess: (_result, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: githubSearchInstallationKeys.list(organizationId),
        }),
        queryClient.invalidateQueries({
          queryKey: oauthCredentialKeys.list('github-repositories', '', '', organizationId),
        }),
      ]),
  })
}
