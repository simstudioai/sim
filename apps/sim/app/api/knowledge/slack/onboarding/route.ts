import { getSlackSearchOnboardingContract } from '@/lib/api/contracts/knowledge/slack'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getSlackSearchOnboarding,
  slackSearchOnboardingOperations,
} from '@/lib/knowledge/application/slack-search/onboarding'

export const GET = defineInternalJsonRoute({
  contract: getSlackSearchOnboardingContract,
  auth: internalSessionAuth,
  operation: slackSearchOnboardingOperations.read,
  rateLimit: internalRateLimits.user({ bucketName: 'slack-search-onboarding' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  mapInput: ({ query }) => query,
  useCase: getSlackSearchOnboarding,
})
