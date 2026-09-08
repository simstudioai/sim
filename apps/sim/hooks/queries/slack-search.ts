'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConfigureSlackSearchBody,
  configureSlackSearchContract,
  listSlackSearchContract,
  removeSlackSearchContract,
} from '@/lib/api/contracts/knowledge/slack'

export const SLACK_SEARCH_STALE_TIME = 30_000
export const slackSearchKeys = {
  all: ['slack-search'] as const,
  lists: () => [...slackSearchKeys.all, 'list'] as const,
  list: (organizationId?: string) => [...slackSearchKeys.lists(), organizationId ?? ''] as const,
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
    onSettled: (_result, _error, input) =>
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
