'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listSlackSearchContract,
  type StartSlackSearchOAuthBody,
  startSlackSearchOAuthContract,
} from '@/lib/api/contracts/knowledge/slack'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { organizationAccountsKeys } from '@/hooks/queries/utils/organization-accounts-keys'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

export const SLACK_SEARCH_STALE_TIME = 30_000

export function useStartSlackSearchOAuth() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      signal,
      ...body
    }: StartSlackSearchOAuthBody & { signal?: AbortSignal }) => {
      if (isDesktopApp()) {
        await connectDesktopSource({ kind: 'slack-search', body }, signal)
        return null
      }
      return requestJson(startSlackSearchOAuthContract, { body, signal })
    },
    onSettled: (_data, _error, input) =>
      Promise.all([
        client.invalidateQueries({ queryKey: slackSearchKeys.list(input.organizationId) }),
        client.invalidateQueries({
          queryKey: slackSearchKeys.organizationManifests(input.organizationId),
        }),
        client.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(input.organizationId),
        }),
      ]),
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
