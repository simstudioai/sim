'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getSlackSearchOnboardingContract,
  retrySlackSearchOnboardingContract,
  type SlackSearchOnboardingInput,
} from '@/lib/api/contracts/knowledge/slack'

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

export function useRetrySlackSearchOnboarding(userId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: SlackSearchOnboardingInput) =>
      requestJson(retrySlackSearchOnboardingContract, { body }),
    onSettled: (_result, _error, input) =>
      client.invalidateQueries({ queryKey: slackOnboardingKeys.detail(input.token, userId) }),
  })
}
