'use client'

import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getSlackSearchOnboardingContract } from '@/lib/api/contracts/knowledge/slack'

export const SLACK_ONBOARDING_STALE_TIME = 0
export const slackOnboardingKeys = {
  all: ['slack-onboarding'] as const,
  details: () => [...slackOnboardingKeys.all, 'detail'] as const,
  detail: (token: string, userId: string) =>
    [...slackOnboardingKeys.details(), token, userId] as const,
}

export function useSlackSearchOnboarding(token: string, userId: string) {
  return useQuery({
    queryKey: slackOnboardingKeys.detail(token, userId),
    queryFn: ({ signal }) =>
      requestJson(getSlackSearchOnboardingContract, { query: { token }, signal }),
    staleTime: SLACK_ONBOARDING_STALE_TIME,
    retry: false,
  })
}
