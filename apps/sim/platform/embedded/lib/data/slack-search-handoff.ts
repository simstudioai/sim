'use client'

import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'

/**
 * Where a Slack onboarding link stands on this organization's integrations page: unread, failed,
 * belonging to another organization or not yet ready to connect here, or back in the Slack thread.
 */
export function useSlackSearchHandoff(organizationId: string, token: string, userId: string) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  const data = status.data
  const check = {
    checking: status.isFetching,
    check: () => void status.refetch(),
    checkError: status.isRefetchError ? status.error.message : null,
  }
  if (!data) return { stage: 'unread' as const, error: status.error?.message ?? null }
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return { stage: 'elsewhere' as const }
  return {
    stage: 'here' as const,
    ...check,
    slackUrl: data.slackUrl,
    ready: data.status === 'ready',
    retried: data.status === 'retried' || retry.isSuccess,
    retrying: retry.isPending,
    retry: () => retry.mutate({ token }),
    retryError: retry.isError ? retry.error.message : null,
  }
}
