'use client'

import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

/** A connection a chat or link asked for, offered ahead of the Integrations inventory. */
export function useSearchConnectionRequest(
  organizationId: string,
  userId: string,
  target: SearchConnectionTarget
) {
  return useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId: 'integrations-link',
  })
}

/**
 * Where a Slack onboarding link stands on this organization's integrations page: unread, failed,
 * belonging to another organization or not yet ready to connect here, or back in the Slack thread.
 */
export function useSlackSearchHandoff(organizationId: string, token: string, userId: string) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  const data = status.data
  if (!data) return { stage: 'unread' as const, error: status.error?.message ?? null }
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return { stage: 'elsewhere' as const, finishHref: slackSearchOnboardingPath(token) }
  return {
    stage: 'here' as const,
    checking: status.isFetching,
    check: () => void status.refetch(),
    checkError: status.isRefetchError ? status.error.message : null,
    slackUrl: data.slackUrl,
    ready: data.status === 'ready',
    retried: data.status === 'retried' || retry.isSuccess,
    retrying: retry.isPending,
    retry: () => retry.mutate({ token }),
    retryError: retry.isError ? retry.error.message : null,
  }
}
