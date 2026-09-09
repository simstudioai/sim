import { retrySlackSearchOnboardingContract } from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  retrySlackSearchOnboarding,
  slackSearchOnboardingOperations,
} from '@/lib/knowledge/application/slack-search/onboarding'

export const POST = defineInternalJsonRoute({
  contract: retrySlackSearchOnboardingContract,
  auth: internalSessionAuth,
  operation: slackSearchOnboardingOperations.retry,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-onboarding-retry' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  mapInput: ({ body }) => body,
  useCase: retrySlackSearchOnboarding,
})
