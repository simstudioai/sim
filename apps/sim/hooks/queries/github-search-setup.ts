'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  cancelGitHubSearchSetupContract,
  type GitHubSearchSetupScope,
  readGitHubSearchSetupContract,
  type SelectGitHubSearchSetupBody,
  type StartGitHubSearchSetupBody,
  selectGitHubSearchSetupContract,
  startGitHubSearchSetupContract,
} from '@/lib/api/contracts/knowledge/github-setup'

export function isGitHubSetupTerminalError(error: unknown): boolean {
  return (
    isApiClientError(error) &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 429].includes(error.status)
  )
}

export const githubSearchSetupKeys = {
  all: ['github-search-setup'] as const,
  details: () => [...githubSearchSetupKeys.all, 'detail'] as const,
  detail: (scope?: GitHubSearchSetupScope) =>
    [
      ...githubSearchSetupKeys.details(),
      scope?.organizationId ?? '',
      scope?.setupId ?? '',
    ] as const,
}

export function useGitHubSearchSetup(scope?: GitHubSearchSetupScope) {
  return useQuery({
    queryKey: githubSearchSetupKeys.detail(scope),
    queryFn: async ({ signal }) => {
      if (!scope) throw new Error('GitHub connection attempt is required')
      return (await requestJson(readGitHubSearchSetupContract, { query: scope, signal })).data
    },
    enabled: Boolean(scope),
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: (failures, error) => !isGitHubSetupTerminalError(error) && failures < 2,
    refetchInterval: (query) =>
      scope &&
      !isGitHubSetupTerminalError(query.state.error) &&
      (!query.state.data || ['pending', 'choosing'].includes(query.state.data.status))
        ? query.state.error
          ? 5000
          : 1500
        : false,
  })
}

export function useStartGitHubSearchSetup() {
  return useMutation({
    mutationFn: (body: StartGitHubSearchSetupBody) =>
      requestJson(startGitHubSearchSetupContract, { body }),
  })
}

export function useCancelGitHubSearchSetup() {
  return useMutation({
    mutationFn: (body: GitHubSearchSetupScope) =>
      requestJson(cancelGitHubSearchSetupContract, { body }),
  })
}

export function useSelectGitHubSearchSetup() {
  return useMutation({
    mutationFn: (body: SelectGitHubSearchSetupBody) =>
      requestJson(selectGitHubSearchSetupContract, { body }),
  })
}
